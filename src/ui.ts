import { mount } from "svelte";
import App from "./ui/App.svelte";

const target = document.getElementById("app");
if (target) mount(App, { target });
