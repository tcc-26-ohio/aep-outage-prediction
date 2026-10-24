import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientChat } from './client/ClientChat';

createRoot(document.getElementById('root')!).render(<ClientChat />);
