import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { seedDatabase } from './lib/seed';
import { setupSyncListeners, syncOfflineData } from './lib/sync';
import { Login } from './pages/Login';
import { AgentSearch } from './pages/AgentSearch';
import { AgentRoute } from './pages/AgentRoute';
import { AgentDispatchSummary } from './pages/AgentDispatchSummary';
import { ConsumerProfile } from './pages/ConsumerProfile';
import { ConsumerPortal } from './pages/ConsumerPortal';
import { ManagerDashboard } from './pages/ManagerDashboard';
import { ManagerDispatch } from './pages/ManagerDispatch';
import { ManagerMap } from './pages/ManagerMap';
import { ManagerAgents } from './pages/ManagerAgents';
import { ManagerReports } from './pages/ManagerReports';
import { ManagerConsumers } from './pages/ManagerConsumers';
import { ManagerConsumerProfile } from './pages/ManagerConsumerProfile';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  useEffect(() => {
    setupSyncListeners();
    syncOfflineData().catch(console.error);
  }, []);

  return (
    <BrowserRouter>
      <Toaster 
        position="top-center" 
        toastOptions={{ duration: 3000 }} 
        containerStyle={{
          top: '50%',
          transform: 'translateY(-50%)'
        }}
      />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/portal" element={<ConsumerPortal />} />
        
        {/* Agent Routes */}
        <Route path="/agent/search" element={
          <ProtectedRoute allowedRole="AGENT"><AgentSearch /></ProtectedRoute>
        } />
        <Route path="/agent/route" element={
          <ProtectedRoute allowedRole="AGENT"><AgentRoute /></ProtectedRoute>
        } />
        <Route path="/agent/dispatch" element={
          <ProtectedRoute allowedRole="AGENT"><AgentDispatchSummary /></ProtectedRoute>
        } />
        <Route path="/agent/consumer/:id" element={
          <ProtectedRoute allowedRole="AGENT"><ConsumerProfile /></ProtectedRoute>
        } />

        {/* Manager Routes */}
        <Route path="/manager/dashboard" element={
          <ProtectedRoute allowedRole="MANAGER"><ManagerDashboard /></ProtectedRoute>
        } />
        <Route path="/manager/dispatch" element={
          <ProtectedRoute allowedRole="MANAGER"><ManagerDispatch /></ProtectedRoute>
        } />
        <Route path="/manager/map" element={
          <ProtectedRoute allowedRole="MANAGER"><ManagerMap /></ProtectedRoute>
        } />
        <Route path="/manager/agents" element={
          <ProtectedRoute allowedRole="MANAGER"><ManagerAgents /></ProtectedRoute>
        } />
        <Route path="/manager/consumers" element={
          <ProtectedRoute allowedRole="MANAGER"><ManagerConsumers /></ProtectedRoute>
        } />
        <Route path="/manager/consumer/:id" element={
          <ProtectedRoute allowedRole="MANAGER"><ManagerConsumerProfile /></ProtectedRoute>
        } />
        <Route path="/manager/reports" element={
          <ProtectedRoute allowedRole="MANAGER"><ManagerReports /></ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
