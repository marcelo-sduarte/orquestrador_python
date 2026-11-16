import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import App from './App.jsx';
import './estilo.css';

createRoot(document.getElementById('root')).render(<App />);
