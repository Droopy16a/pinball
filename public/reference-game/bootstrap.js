// Local host adapter for the original 247 Pinball browser build.
window.games247 = {};
const narrowScreen = matchMedia('(max-width: 799px)');
const updateLayout = () => {
  document.documentElement.classList.toggle('desktop', !narrowScreen.matches);
  document.documentElement.classList.toggle('mobile', narrowScreen.matches);
};
updateLayout();
narrowScreen.addEventListener('change', updateLayout);
const settingsKey = 'com.games247.pinball.GameSettings';
try {
  const settings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
  settings.levelSelectPage = 3;
  settings.fullscreen = false;
  localStorage.setItem(settingsKey, JSON.stringify(settings));
} catch { /* The game also supports an in-memory storage fallback. */ }
document.getElementById('app-player').oncontextmenu = event => { event.preventDefault(); };
const presenter = document.createElement('script');
presenter.src = './stake-presenter.js';
presenter.onload = async () => {
  try {
    const image = new Image();
    image.src = './game/images/247/bumper_plus_off.webp';
    await image.decode();
    window.pinballPlusBumperImage = image;
    loadTable();
  } catch {
    document.getElementById('preloader-msg').textContent = 'Unable to load bumper artwork. Refresh to try again.';
    window.parent.postMessage({ type: 'pinball-error' }, location.origin);
  }
};
presenter.onerror = () => window.parent.postMessage({ type: 'pinball-error' }, location.origin);
document.head.appendChild(presenter);
function loadTable() {
const script = document.createElement('script');
script.id = 'game-script';
script.dataset.theme = '247';
script.dataset.basepath = './';
script.src = './game/js/main.js';
script.onGameLoaded = () => script.startGame();
script.onload = () => script.loadGame({ showRateUsButton: false });
script.onerror = () => {
  document.getElementById('preloader-msg').textContent = 'Unable to load. Refresh to try again.';
  window.parent.postMessage({ type: 'pinball-error' }, location.origin);
};
document.head.appendChild(script);
}
