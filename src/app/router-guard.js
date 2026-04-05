const ACCESS_PASS_KEY = 'village_access_granted';
const STATE_STORAGE_KEY = 'game_state_v2';

export function checkAccess() {
    const accessPass = sessionStorage.getItem(ACCESS_PASS_KEY);
    const existingGame = localStorage.getItem(STATE_STORAGE_KEY);

    sessionStorage.removeItem(ACCESS_PASS_KEY); // Clear the pass after checking

    if (accessPass || existingGame) {
        return { granted: true, forcedNew: accessPass === 'forced_new' };
    } else {
        console.warn("Acceso no permitido. No se encontró pase ni partida guardada.");
        return { granted: false };
    }
}
