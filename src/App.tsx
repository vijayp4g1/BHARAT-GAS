import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { seedDatabase } from './lib/seed';
import { setupSyncListeners, syncOfflineData, pullLatestCloudData } from './lib/sync';
import { stripCacheBustParam } from './lib/appCache';
import { runDailyStorageMaintenance } from './lib/storageCleanup';
import { fetchAgencySettings } from './lib/agencySettings';
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
import { FindDeliveryAgent } from './pages/FindDeliveryAgent';
import { StaffDayEndSummary } from './pages/StaffDayEndSummary';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  useEffect(() => {
    // Remove the temporary ?appv=<timestamp> used to bypass a stale app shell.
    stripCacheBustParam();

    // Once per day, clear re-fetchable display caches and abandoned drafts so
    // localStorage cannot fill up and block login again.
    runDailyStorageMaintenance();

    // Keep the shared manager-only cylinder rate cached for day-end entry.
    void fetchAgencySettings();
    const syncSettings = () => {
      if (navigator.onLine) void fetchAgencySettings();
    };
    window.addEventListener('online', syncSettings);

    setupSyncListeners();
    syncOfflineData().catch(console.error);
    pullLatestCloudData().catch(console.error);
    // The 33k customer master is intentionally NOT auto-synced. It is updated
    // manually at most once a week from Manager Dashboard / Agent Search.
    // Incremental locations/photos/notes are pulled on app open, on reconnect,
    // and from the manual Refresh button — not on a timer.

    return () => {
      window.removeEventListener('online', syncSettings);
    };
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
        
        {/* Staff Book was removed. Old links/bookmarks land on Day End. */}
        <Route path="/staff/settlement" element={<Navigate to="/staff/day-end" replace />} />
        <Route path="/staff/day-end" element={
          <ProtectedRoute allowedRole="STAFF"><StaffDayEndSummary /></ProtectedRoute>
        } />

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
        <Route path="/agent/find-agent" element={
          <ProtectedRoute allowedRole="AGENT"><FindDeliveryAgent /></ProtectedRoute>
        } />

        {/* Manager Routes */}
        <Route path="/manager/dashboard" element={
          <ProtectedRoute allowedRole="MANAGER"><ManagerDashboard /></ProtectedRoute>
        } />
        <Route path="/manager/find-agent" element={
          <ProtectedRoute allowedRole="MANAGER"><FindDeliveryAgent /></ProtectedRoute>
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
