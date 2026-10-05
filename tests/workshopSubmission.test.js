import test from 'node:test';
import assert from 'node:assert/strict';
import { submitWorkshopRecord } from '../server/workshopSubmission.js';

function database(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return { rows, collection: name => ({ doc: id => ({ path: `${name}/${id}`, id }) }),
    async runTransaction(run) {
      const writes = [];
      const result = await run({ get: async ref => ({ exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) }),
        set: (ref, data) => writes.push([ref.path, data]),
        update: (ref, data) => writes.push([ref.path, { ...rows.get(ref.path), ...data }]),
      });
      for (const [key, value] of writes) rows.set(key, structuredClone(value));
      return result;
    } };
}
const user = { companyId: 'a', isEnabled: true, appAccess: { service: true } };
const record = { companyId: 'a', vehicleId: 'van', serviceType: 'Full service', serviceDate: '2026-10-05 10:00', serviceDateOnly: '2026-10-05', nextServiceDate: '2027-01-05', signedBy: 'Technician', odometer: 250, workSummary: 'Serviced' };
const body = { recordId: 'sheet', record, defects: [] };
const setup = (extra = {}) => database({ 'users/tech': user, 'vehicles/van': { companyId: 'a', lastService: '2026-01-01', serviceHistory: [], motHistory: ['keep'], operationalStatus: 'VOR' }, ...extra });
const token = { uid: 'tech', firebase: { sign_in_provider: 'password' }, auth_time: 1000 };
const submit = (db, payload = body) => submitWorkshopRecord({ db, uid: 'tech', token, body: structuredClone(payload), now: '2026-10-05T10:00:00.000Z' });
test('service submission saves signed record and history atomically without changing MOT or VOR', async () => {
  const db = setup(); await submit(db);
  assert.equal(db.rows.get('serviceRecords/sheet').companyId, 'a');
  assert.equal(db.rows.get('serviceRecords/sheet').submittedByUid, 'tech');
  const van = db.rows.get('vehicles/van');
  assert.equal(van.lastService, '2026-10-05'); assert.equal(van.nextService, '2027-01-05');
  assert.equal(van.serviceHistory[0].serviceRecordId, 'sheet');
  assert.deepEqual(van.motHistory, ['keep']); assert.equal(van.operationalStatus, 'VOR');
});
test('retry of committed submission returns success without duplicate history', async () => {
  const db = setup(); await submit(db); const result = await submit(db);
  assert.equal(result.replayed, true); assert.equal(db.rows.get('vehicles/van').serviceHistory.length, 1);
});
test('signed record cannot be overwritten by changed payload or another actor', async () => {
  const db = setup(); await submit(db);
  await assert.rejects(submit(db, { ...body, record: { ...record, workSummary: 'changed' } }), /already|immutable/i);
  db.rows.set('users/other', user);
  await assert.rejects(submitWorkshopRecord({ db, uid: 'other', token: { ...token, uid: 'other' }, body }), /already|immutable/i);
});
test('foreign vehicle and foreign payload company fail before any write', async () => {
  for (const extra of [{ 'vehicles/van': { companyId: 'b' } }, {}]) {
    const db = setup(extra);
    const payload = extra['vehicles/van'] ? body : { ...body, record: { ...record, companyId: 'b' } };
    await assert.rejects(submit(db, payload), /company|vehicle/i);
    assert.equal(db.rows.has('serviceRecords/sheet'), false);
  }
});
test('disabled, setup-required and user-only accounts are denied', async () => {
  for (const patch of [{ isEnabled: false }, { appAccess: { user: true } }, { appPasswordSetupRequired: true }, { companyId: '' }]) {
    const db = setup({ 'users/tech': { ...user, ...patch } });
    await assert.rejects(submit(db)); assert.equal(db.rows.has('serviceRecords/sheet'), false);
  }
});
test('repair updates only repair history and mileage', async () => {
  const db = setup(); await submit(db, { ...body, record: { ...record, serviceType: 'General repair', recordType: 'repair', repairSummary: 'Lamp replaced', completedDate: '2026-10-05' } });
  const van = db.rows.get('vehicles/van'); assert.equal(van.lastService, '2026-01-01');
  assert.equal(van.repairHistory[0].serviceRecordId, 'sheet'); assert.equal(van.odometer, 250);
});
test('standalone repair allows manually entered vehicle details', async () => {
  const db = setup(); await submit(db, { ...body, record: { ...record, vehicleId: null, serviceType: 'General repair', recordType: 'repair', vehicleName: 'External van' } });
  assert.equal(db.rows.has('serviceRecords/sheet'), true); assert.equal(db.rows.get('vehicles/van').lastService, '2026-01-01');
});
test('defects are stamped and linked by server; spoofed vehicle cannot be persisted', async () => {
  const db = setup(); await submit(db, { ...body, defects: [{ id: 'defect', data: { vehicleId: 'foreign', companyId: 'b', description: 'Brake fault', status: 'resolved' } }] });
  const defect = db.rows.get('defectReports/defect');
  assert.equal(defect.companyId, 'a'); assert.equal(defect.vehicleId, 'van'); assert.equal(defect.status, 'open'); assert.equal(defect.sourceRecordId, 'sheet');
});
test('matching workshop request completes with the record; wrong asset fails atomically', async () => {
  for (const assetId of ['van', 'other']) {
    const db = setup({ 'workshopRequests/request': { companyId: 'a', status: 'open', workType: 'full_service', assetId } });
    const payload = { ...body, record: { ...record, workshopRequestId: 'request', workshopWorkType: 'full_service' } };
    if (assetId === 'van') { await submit(db, payload); assert.equal(db.rows.get('workshopRequests/request').status, 'completed'); }
    else { await assert.rejects(submit(db, payload)); assert.equal(db.rows.has('serviceRecords/sheet'), false); }
  }
});
test('malformed date, odometer, path and unsupported record fields fail', async () => {
  for (const patch of [{ serviceDateOnly: '2026-02-30' }, { odometer: -1 }, { vehicleId: '../foreign' }, { companyId: 'a', legalSignedOffAt: 'forged' }]) await assert.rejects(submit(setup(), { ...body, record: { ...record, ...patch } }));
});
test('an existing unsigned company draft can be submitted while signed history stays immutable', async () => {
  const db = setup({ 'serviceRecords/sheet': { companyId: 'a', vehicleId: 'van', signedBy: '', createdAt: '2026-10-01', extraMetadata: 'keep' } });
  await submit(db, { ...body, mode: 'update' });
  assert.equal(db.rows.get('serviceRecords/sheet').signedBy, 'Technician');
  assert.equal(db.rows.get('serviceRecords/sheet').createdAt, '2026-10-01');
  assert.equal(db.rows.get('serviceRecords/sheet').extraMetadata, 'keep');
});
test('backdated service and lower odometer never regress current vehicle markers', async () => {
  const db = setup({ 'vehicles/van': { companyId: 'a', lastService: '2026-10-06', odometer: 500, nextService: '2027-01-06' } });
  await submit(db); const van = db.rows.get('vehicles/van');
  assert.equal(van.lastService, '2026-10-06'); assert.equal(van.odometer, 500); assert.equal(van.nextService, '2027-01-06'); assert.equal(van.serviceHistory.length, 1);
});
test('alias-only dates and differing mileage mirrors cannot be regressed', async () => {
  const db = setup({ 'vehicles/van': { companyId: 'a', lastServiceDate: '2026-10-06', odometer: 100, mileage: 500 } });
  await submit(db); const van = db.rows.get('vehicles/van');
  assert.equal(van.lastServiceDate, '2026-10-06'); assert.equal(van.mileage, 500);
});
test('revoked sessions, pending recovery and non-password identities cannot submit', async () => {
  for (const patch of [{ sessionValidAfter: 1000 }, { sessionsRevokedAt: '1970-01-01T00:16:40Z' }, { appPasswordSessionAfter: 1000 }, { passwordResetRequired: true }, { firebasePasswordResetAfter: 1 }, { appDisabled: true }, { archived: true }, { featureFlags: { service: false } }]) {
    await assert.rejects(submit(setup({ 'users/tech': { ...user, ...patch } })));
  }
  await assert.rejects(submitWorkshopRecord({ db: setup(), uid: 'tech', token: { ...token, firebase: { sign_in_provider: 'anonymous' } }, body }));
});
