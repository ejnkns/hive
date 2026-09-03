// Storybook's preview imports the app's theme-token stylesheet (ui/app.css)
// as a side-effect Vite CSS import; this ambient declaration lets tsc accept
// the specifier.
declare module "*.css";
