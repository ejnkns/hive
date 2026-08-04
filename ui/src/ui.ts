import { mount } from "svelte";
import App from "./App.svelte";
import { defineFlowRenderingComponents } from "./flow-rendering";

defineFlowRenderingComponents();

const target = document.getElementById("app");
if (target) mount(App, { target });
