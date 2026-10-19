import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { registerShell } from './lib/shell';

mount(App, { target: document.getElementById('app')! });

// Só na build: em desenvolvimento, o Vite serve tudo da rede.
if (import.meta.env.PROD) registerShell(import.meta.env.BASE_URL);
