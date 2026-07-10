import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { seedDatabase } from './lib/seed';
import { setupSyncListeners, syncOfflineData } from './lib/sync';
import { Login } from './pages/Login';
import { AgentSearch } from './pages/AgentSearch';
import { ConsumerProfile } from './pages/ConsumerProfile';
import { ManagerDashboard } from './pages/ManagerDashboard';
import { ManagerMap } from './pages/ManagerMap';
import { ManagerAgents } from './pages/ManagerAgents';
import { ManagerReports } from './pages/ManagerReports';
import { ManagerConsumers } from './pages/ManagerConsumers';
import { ManagerConsumerProfile } from './pages/ManagerConsumerProfile';
import { PrivateRoute } from './components/PrivateRoute';

function App() {
  useEffect(() => {
    setupSyncListeners();
    syncOfflineData().catch(console.error);
  }, []);

  return (
    <BrowserRouter>
      <Toaster position="top-center" />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/agent/search" element={<AgentSearch />} />
        <Route path="/agent/consumer/:id" element={<ConsumerProfile />} />
        <Route path="/manager/dashboard" element={<ManagerDashboard />} />
        <Route path="/manager/map" element={<ManagerMap />} />
        <Route path="/manager/agents" element={<ManagerAgents />} />
        <Route path="/manager/consumers" element={<ManagerConsumers />} />
        <Route path="/manager/consumer/:id" element={<ManagerConsumerProfile />} />
        <Route path="/manager/reports" element={<ManagerReports />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
