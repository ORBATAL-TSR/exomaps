import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TopNav from './components/TopNav';
import StarMapPage from './pages/StarMapPage';
import AdminPage from './pages/AdminPage';
import SimulationPage from './pages/SimulationPage';
import CampaignPage from './pages/CampaignPage';
import DataQAPage from './pages/DataQAPage';
import './App.css';

const SystemViewerPage = lazy(() => import('./pages/SystemViewerPage'));

function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          {/* Fullscreen system viewer — no TopNav / app-main wrapper */}
          <Route
            path="/system/:id"
            element={
              <Suspense fallback={<div style={{ background: '#030712', width: '100vw', height: '100vh' }} />}>
                <SystemViewerPage />
              </Suspense>
            }
          />
          {/* Standard layout routes */}
          <Route
            path="*"
            element={
              <>
                <TopNav />
                <main className="app-main">
                  <Routes>
                    <Route path="/" element={<StarMapPage />} />
                    <Route path="/campaigns" element={<CampaignPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/simulation" element={<SimulationPage />} />
                    <Route path="/data-qa" element={<DataQAPage />} />
                  </Routes>
                </main>
              </>
            }
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
