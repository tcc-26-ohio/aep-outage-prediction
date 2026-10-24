import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { MapPage } from './map/MapPage';


function App() {
  return <MapPage />;
}



createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
