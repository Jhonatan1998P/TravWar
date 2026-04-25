export function compareMovementsByArrival(left, right) {
    const arrivalDelta = (Number(left?.arrivalTime) || 0) - (Number(right?.arrivalTime) || 0);
    if (arrivalDelta !== 0) return arrivalDelta;

    const startDelta = (Number(left?.startTime) || 0) - (Number(right?.startTime) || 0);
    if (startDelta !== 0) return startDelta;

    return String(left?.id || '').localeCompare(String(right?.id || ''));
}
