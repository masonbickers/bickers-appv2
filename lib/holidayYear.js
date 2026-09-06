export function holidayBelongsToYear(holiday, year, startDate) {
  const recordedYear = [holiday?.holidayYear, holiday?.leaveYear, holiday?.year].find(
    (value) => value !== undefined && value !== null && String(value).trim() !== ""
  );

  if (recordedYear !== undefined) {
    const parsedYear = Number(recordedYear);
    if (Number.isInteger(parsedYear)) return parsedYear === Number(year);
  }

  return !!startDate && startDate.getFullYear() === Number(year);
}

export function calculateRemainingHolidayAllowance(totalAllowance, takenDays, bookedDays = 0) {
  const allowance = Number(totalAllowance);
  const taken = Number(takenDays);
  const booked = Number(bookedDays);
  return (Number.isFinite(allowance) ? allowance : 0) -
    (Number.isFinite(taken) ? taken : 0) -
    (Number.isFinite(booked) ? booked : 0);
}
