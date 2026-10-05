import { createHash } from 'node:crypto';

const fields = new Set(('companyId vehicleId vehicleName registration manufacturer model serviceType recordType serviceDate serviceDateOnly serviceTime completedDate odometer workSummary repairSummary repairReason partsUsed extraNotes signedBy completedBy nextServiceDate nextService serviceFormNumber serviceFormNumberValue checks checkRatings checkNA checkNotes wheelInspection monitorReport serviceDefectActions checkPhotoURIs checkPhotoURLs photoURIs photoURLs workshopRequestId workshopWorkType').split(' '));
const serviceTypes = new Set(['Full service', 'Interim service', 'Oil & filter change', 'Inspection only', 'Other', 'General repair']);
const admins = new Set(['admin', 'companyadmin', 'company admin', 'platformadmin', 'platform admin', 'superadmin', 'super admin']);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = value => String(value ?? '').trim();
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export async function submitWorkshopRecord({ db, uid, token, body, now = new Date().toISOString() }) {
  if (!uid || !body || !id(body.recordId) || !body.record || Array.isArray(body.record)) throw fail('A valid workshop record is required.');
  if (body.ownerUid && body.ownerUid !== uid) throw fail('This workshop form belongs to another signed-in account.', 403);
  const record = {};
  for (const [key, value] of Object.entries(body.record)) {
    if (['createdAt', 'updatedAt'].includes(key)) continue;
    if (!fields.has(key)) throw fail(`Unsupported workshop field: ${key}.`);
    record[key] = value;
  }
  const repair = record.serviceType === 'General repair';
  if (!serviceTypes.has(record.serviceType) || repair !== (record.recordType === 'repair') && record.recordType) throw fail('Unsupported workshop record type.');
  if (!date(record.serviceDateOnly) || record.nextServiceDate && !date(record.nextServiceDate)) throw fail('Invalid service date.');
  if (record.odometer != null && (typeof record.odometer !== 'number' || !Number.isFinite(record.odometer) || record.odometer < 0)) throw fail('Invalid odometer.');
  if (record.vehicleId != null && !id(record.vehicleId)) throw fail('Invalid vehicle ID.');
  if (!record.vehicleId && (!repair || !text(record.vehicleName || record.registration))) throw fail('Select a vehicle.');
  if (!text(record.signedBy) && !repair) throw fail('A signature is required.');
  if (!text(record.workSummary || record.repairSummary) && repair) throw fail('A repair summary is required.');
  if (record.workshopRequestId && !id(record.workshopRequestId)) throw fail('Invalid workshop request.');
  const defects = body.defects || [];
  if (!Array.isArray(defects) || defects.length > 100 || defects.some(d => !id(d.id) || !d.data || !text(d.data.description)) || new Set(defects.map(d => d.id)).size !== defects.length) throw fail('Invalid workshop defects.');
  if (repair && defects.length) throw fail('Repair records cannot create service-sheet defects.');
  const hash = createHash('sha256').update(JSON.stringify(canonical({ record, defects }))).digest('hex');
  const recordRef = db.collection('serviceRecords').doc(body.recordId);
  return db.runTransaction(async tx => {
    const user = (await tx.get(db.collection('users').doc(uid))).data() || {};
    const companyId = text(user.companyId);
    const cutoff = Math.max(Number(user.sessionValidAfter) || 0, Date.parse(user.sessionsRevokedAt || '') / 1000 || 0, Number(user.appPasswordSessionAfter) || 0);
    if (token?.uid !== uid || token.firebase?.sign_in_provider !== 'password' || Number(token.auth_time || 0) <= cutoff || user.uid && user.uid !== uid || user.passwordResetRequired === true || user.firebasePasswordResetAfter) throw fail('Sign in again and complete any required password recovery.', 401);
    if (!companyId || user.isEnabled !== true || user.disabled === true || user.active === false || user.appDisabled === true || user.archived === true || user.isArchived === true || user.featureFlags?.service === false || user.appPasswordSetupRequired === true || !(user.appAccess?.service === true || admins.has(text(user.role).toLowerCase()))) throw fail('Service workspace access is required.', 403);
    if (record.companyId && record.companyId !== companyId) throw fail('Record belongs to another company.', 403);
    const existing = await tx.get(recordRef);
    let previous = null;
    if (existing.exists) {
      previous = existing.data();
      if (previous.companyId === companyId && previous.submittedByUid === uid && previous.submissionHash === hash) return { recordId: body.recordId, replayed: true, record: previous };
      const unsigned = !previous.signedBy && !previous.signedAt && !previous.signature && !previous.signatureSvgPath && !['complete', 'completed', 'closed', 'cancelled', 'archived', 'submitted'].includes(text(previous.status).toLowerCase());
      if (body.mode !== 'update' || previous.companyId !== companyId || !unsigned || previous.submissionHash) throw fail('This record is already saved and immutable. Open a new form for further work.', 409);
    }
    const vehicleRef = record.vehicleId ? db.collection('vehicles').doc(record.vehicleId) : null;
    const vehicle = vehicleRef ? (await tx.get(vehicleRef)).data() : null;
    if (vehicleRef && (!vehicle || vehicle.companyId !== companyId)) throw fail('Vehicle belongs to another company or is unavailable.', 403);
    const requestRef = record.workshopRequestId ? db.collection('workshopRequests').doc(record.workshopRequestId) : null;
    const request = requestRef ? (await tx.get(requestRef)).data() : null;
    const workType = repair ? 'general_repair' : 'full_service';
    if (requestRef && (!request || request.companyId !== companyId || request.status !== 'open' || request.assetId !== record.vehicleId || request.workType !== workType || record.workshopWorkType !== workType || !repair && record.serviceType !== 'Full service')) throw fail('Workshop request is not open for this vehicle and form.', 409);
    const defectWrites = [];
    for (const defect of defects) {
      const ref = db.collection('defectReports').doc(defect.id);
      if ((await tx.get(ref)).exists) throw fail('Defect record already exists.', 409);
      const source = defect.data;
      defectWrites.push({ ref, data: {
        companyId, vehicleId: record.vehicleId, vehicleName: record.vehicleName || '', registration: record.registration || '',
        location: 'Service form', description: text(source.description), severity: 'Immediate', priority: 'high', offRoad: false,
        reportedBy: text(record.signedBy), reporterUid: uid, notes: text(source.notes), status: 'open', source: 'serviceForm',
        sourceRecordId: body.recordId, sourceDefectKey: text(source.sourceDefectKey), photoURIs: [], photoURLs: [], createdAt: now, updatedAt: now,
      } });
    }
    const saved = { ...(previous || {}), ...record, companyId, signedBy: text(record.signedBy) || text(user.displayName || user.name) || uid, submittedByUid: uid, submissionHash: hash, createdAt: previous?.createdAt || now, updatedAt: now };
    tx.set(recordRef, saved);
    for (const defect of defectWrites) tx.set(defect.ref, defect.data);
    let vehiclePatch = null;
    if (vehicleRef) {
      vehiclePatch = {};
      const history = {
        completedDate: record.serviceDateOnly, serviceRecordId: body.recordId,
        notes: [record.workSummary, record.extraNotes].filter(Boolean).join(' '), odometer: record.odometer ?? null,
        partsUsed: record.partsUsed || '', recordedAt: now,
      };
      if (repair) {
        vehiclePatch.repairHistory = [...(Array.isArray(vehicle.repairHistory) ? vehicle.repairHistory : []), { ...history, type: 'General repair', repairRecordId: body.recordId, completedBy: saved.signedBy }];
        if (!vehicle.lastRepair?.date || vehicle.lastRepair.date <= record.serviceDateOnly) vehiclePatch.lastRepair = { date: record.serviceDateOnly, summary: record.repairSummary || record.workSummary, serviceRecordId: body.recordId };
      } else {
        vehiclePatch.serviceHistory = [...(Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : []), { ...history, serviceFormNumber: record.serviceFormNumber || '' }];
        const latestService = [vehicle.lastService, vehicle.lastServiceDate].map(value => text(value).slice(0, 10)).filter(date).sort().at(-1);
        if (!latestService || latestService <= record.serviceDateOnly) {
          Object.assign(vehiclePatch, { lastService: record.serviceDateOnly, lastServiceDate: record.serviceDateOnly });
          if (record.nextServiceDate) Object.assign(vehiclePatch, { nextService: record.nextServiceDate, nextServiceDate: record.nextServiceDate, serviceDueDate: record.nextServiceDate });
        }
      }
      const oldOdo = Math.max(0, ...[vehicle.odometer, vehicle.mileage, vehicle.serviceOdometer].map(Number).filter(Number.isFinite));
      if (record.odometer != null && (!Number.isFinite(oldOdo) || record.odometer >= oldOdo)) Object.assign(vehiclePatch, { odometer: record.odometer, mileage: record.odometer, serviceOdometer: record.odometer });
      if (defectWrites.length) vehiclePatch.defects = [...(Array.isArray(vehicle.defects) ? vehicle.defects : []), ...defectWrites.map(d => ({ ...d.data, defectReportId: d.ref.id }))];
      tx.update(vehicleRef, vehiclePatch);
    }
    if (requestRef) tx.update(requestRef, { status: 'completed', formCollection: 'serviceRecords', formRecordId: body.recordId, completedBy: saved.signedBy, completedAt: now, updatedAt: now });
    return { recordId: body.recordId, replayed: false, record: saved, vehiclePatch };
  });
}

export function createWorkshopSubmissionHandler({ db, verifyIdToken }) {
  return async (req, res) => {
    const token = /^Bearer (\S+)$/i.exec(String(req.headers.authorization || ''))?.[1];
    if (!token) return res.status(401).json({ error: 'Sign in to submit workshop work.' });
    try {
      const decoded = await verifyIdToken(token, true);
      if (decoded.firebase?.sign_in_provider === 'anonymous') return res.status(403).json({ error: 'Sign in with your approved account.' });
      const result = await submitWorkshopRecord({ db, uid: decoded.uid, token: decoded, body: req.body });
      res.set('Cache-Control', 'private, no-store');
      return res.json(result);
    } catch (error) {
      return res.status(error.status || (String(error.code || '').startsWith('auth/') ? 401 : 500)).json({ error: error.status ? error.message : 'Workshop submission could not be confirmed. Retry the same saved form.' });
    }
  };
}
