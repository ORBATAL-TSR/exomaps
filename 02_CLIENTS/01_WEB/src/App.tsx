import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TopNav from './components/TopNav';
import StarMapPage from './pages/StarMapPage';
import AdminPage from './pages/AdminPage';
import SimulationPage from './pages/SimulationPage';
import DataQAPage from './pages/DataQAPage';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app">
        <TopNav />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<StarMapPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/simulation" element={<SimulationPage />} />
            <Route path="/data-qa" element={<DataQAPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
