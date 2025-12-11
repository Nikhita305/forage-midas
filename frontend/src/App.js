import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { WebSocketProvider } from "./context/WebSocketContext";
import Login from "./pages/Login";
import DriverDashboard from "./pages/DriverDashboard";
import PoliceDashboard from "./pages/PoliceDashboard";
import AdminPanel from "./pages/AdminPanel";

// Protected Route Component
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect to appropriate dashboard based on role
    switch (user.role) {
      case 'police':
        return <Navigate to="/police" replace />;
      case 'admin':
        return <Navigate to="/admin" replace />;
      case 'driver':
      default:
        return <Navigate to="/driver" replace />;
    }
  }
  
  return <WebSocketProvider>{children}</WebSocketProvider>;
};

// Public Route
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }
  
  if (user) {
    switch (user.role) {
      case 'police':
        return <Navigate to="/police" replace />;
      case 'admin':
        return <Navigate to="/admin" replace />;
      case 'driver':
      default:
        return <Navigate to="/driver" replace />;
    }
  }
  
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={
        <PublicRoute>
          <Login />
        </PublicRoute>
      } />
      
      {/* Ambulance Driver Dashboard */}
      <Route path="/driver" element={
        <ProtectedRoute allowedRoles={['driver']}>
          <DriverDashboard />
        </ProtectedRoute>
      } />
      
      {/* Traffic Police Dashboard */}
      <Route path="/police" element={
        <ProtectedRoute allowedRoles={['police']}>
          <PoliceDashboard />
        </ProtectedRoute>
      } />
      
      {/* Admin Panel */}
      <Route path="/admin" element={
        <ProtectedRoute allowedRoles={['admin']}>
          <AdminPanel />
        </ProtectedRoute>
      } />
      
      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
