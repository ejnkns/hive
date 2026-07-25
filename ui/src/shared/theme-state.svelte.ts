let isLight = $state(
  typeof document !== "undefined" &&
    document.documentElement.classList.contains("light")
);

export function getThemeMode() {
  return isLight ? "light" : "dark";
}

export function setLightMode(v: boolean) {
  isLight = v;
}
