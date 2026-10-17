export {};

const menu = document.getElementById('site-navigation')!;
const menuButton = document.getElementById('menu-toggle')!;
const themeButton = document.getElementById('theme-toggle')!;
const main = document.getElementById('main-content')!;
const social = document.querySelector<HTMLElement>('.site-social')!;
let open = false;

function setMenu(next: boolean) {
  open = next;
  menu.classList.toggle('nav-open', open);
  menu.inert = !open;
  menu.setAttribute('aria-hidden', String(!open));
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  document.getElementById('menu-icon')!.setAttribute('d', open
    ? 'M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z'
    : 'M15 6H1v1h14V6zm0 3H1v1h14V9z');
  main.inert = open;
  social.inert = open;
  document.body.classList.toggle('ovhidden', open);
  if (!open) menuButton.focus();
}
menuButton.addEventListener('click', () => setMenu(!open));
menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', event => {
  if (!open) return;
  if (event.key === 'Escape') { event.preventDefault(); setMenu(false); }
  if (event.key !== 'Tab') return;
  const targets = [themeButton, menuButton, ...menu.querySelectorAll<HTMLElement>('a[href]')];
  const first = targets[0], last = targets[targets.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* Theme can still be used when storage is unavailable. */ }
});
window.addEventListener('storage', event => {
  if (event.key === 'theme' && (event.newValue === 'light' || event.newValue === 'dark')) document.documentElement.dataset.theme = event.newValue;
});
