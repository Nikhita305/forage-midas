import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { 
  Ambulance, Hospital, MapPin, Clock, Activity, AlertTriangle,
  Radio, LogOut, RefreshCw, Send, Users, Zap, Navigation, Settings
} from 'lucide-react';
import { Toaster, toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Status colors
const statusColors = {
  available: '#22c55e',
  on_route: '#3b82f6',
  emergency: '#ef4444',
  offline: '#71717a'
};

// Custom ambulance icons by status
const createAmbulanceIcon = (status) => L.divIcon({
  className: 'custom-ambulance-icon',
  html: `<div style="background: ${statusColors[status] || statusColors.offline}; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const hospitalIcon = L.divIcon({
  className: 'custom-hospital-icon',
  html: `<div style="background: #3b82f6; border-radius: 4px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/></svg>
  </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const trafficIcon = L.divIcon({
  className: 'custom-traffic-icon',
  html: `<div style="background: #eab308; border-radius: 4px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: 2px solid white;">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const DispatcherDashboard = () => {
  const { user, logout } = useAuth();
  const { isConnected, ambulances: wsAmbulances, setAmbulances, alerts } = useWebSocket();
  
  const [ambulances, setLocalAmbulances] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [trafficEvents, setTrafficEvents] = useState([]);
  const [selectedAmbulance, setSelectedAmbulance] = useState(null);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [currentRoute, setCurrentRoute] = useState(null);
  const [specialtyFilter, setSpecialtyFilter] = useState('all');
  const [mapCenter] = useState([40.7128, -74.0060]);

  // Fetch data on mount
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Update local ambulances when WebSocket updates come in
  useEffect(() => {
    if (wsAmbulances.length > 0) {
      setLocalAmbulances(prev => {
        const updated = [...prev];
        wsAmbulances.forEach(wsAmb => {
          const index = updated.findIndex(a => a.id === wsAmb.id);
          if (index >= 0) {
            updated[index] = wsAmb;
          } else {
            updated.push(wsAmb);
          }
        });
        return updated;
      });
    }
  }, [wsAmbulances]);

  const fetchData = async () => {
    try {
      const [ambRes, hospRes, trafficRes] = await Promise.all([
        axios.get(`${API}/ambulances`),
        axios.get(`${API}/hospitals`),
        axios.get(`${API}/traffic/events`)
      ]);
      setLocalAmbulances(ambRes.data);
      setAmbulances(ambRes.data);
      setHospitals(hospRes.data);
      setTrafficEvents(trafficRes.data);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  };

  const assignHospital = async () => {
    if (!selectedAmbulance || !selectedHospital) {
      toast.error('Select ambulance and hospital');
      return;
    }

    try {
      const response = await axios.post(`${API}/assign-hospital`, {
        ambulance_id: selectedAmbulance.id,
        hospital_id: selectedHospital.id
      });
      
      setCurrentRoute(response.data.route);
      toast.success(`Assigned ${selectedAmbulance.call_sign} to ${selectedHospital.name}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to assign hospital');
    }
  };

  const sendEmergencyAlert = async (ambulanceId) => {
    const ambulance = ambulances.find(a => a.id === ambulanceId);
    if (!ambulance) return;

    try {
      await axios.post(`${API}/alerts/send`, {
        ambulance_id: ambulanceId,
        location: ambulance.location,
        radius_km: 1.5
      });
      toast.success('Emergency alert broadcast sent');
    } catch (error) {
      toast.error('Failed to send alert');
    }
  };

  const filteredHospitals = hospitals.filter(h => 
    specialtyFilter === 'all' || h.specialties?.includes(specialtyFilter)
  );

  const allSpecialties = [...new Set(hospitals.flatMap(h => h.specialties || []))];

  const stats = {
    total: ambulances.length,
    available: ambulances.filter(a => a.status === 'available').length,
    onRoute: ambulances.filter(a => a.status === 'on_route').length,
    emergency: ambulances.filter(a => a.status === 'emergency').length,
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <Toaster position="top-right" richColors />
      
      {/* Header */}
      <header className="h-16 bg-zinc-900 border-b border-zinc-800 px-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-md bg-red-500 flex items-center justify-center">
            <Ambulance className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">Dispatch Control</h1>
            <p className="text-xs text-zinc-500">Emergency Response Command</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Stats */}
          <div className="hidden md:flex items-center gap-4 mr-4">
            <div className="flex items-center gap-2 text-sm">
              <div className="status-dot available" />
              <span className="text-zinc-400">Available:</span>
              <span className="text-zinc-100 data-value">{stats.available}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="status-dot on_route" />
              <span className="text-zinc-400">En Route:</span>
              <span className="text-zinc-100 data-value">{stats.onRoute}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="status-dot emergency" />
              <span className="text-zinc-400">Emergency:</span>
              <span className="text-zinc-100 data-value">{stats.emergency}</span>
            </div>
          </div>
          
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            <Radio className="w-3 h-3" />
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </div>
          
          <Button variant="ghost" size="sm" onClick={fetchData} className="text-zinc-400 hover:text-zinc-100">
            <RefreshCw className="w-4 h-4" />
          </Button>
          
          <Button variant="ghost" size="sm" onClick={logout} className="text-zinc-400 hover:text-zinc-100" data-testid="logout-btn">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Ambulances */}
        <div className="w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <Ambulance className="w-4 h-4 text-red-500" />
              Active Units ({ambulances.length})
            </h2>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {ambulances.map(ambulance => (
                <Card 
                  key={ambulance.id}
                  className={`bg-zinc-800 border-zinc-700 cursor-pointer hover:border-zinc-600 transition-all ${selectedAmbulance?.id === ambulance.id ? 'border-red-500 ring-1 ring-red-500/20' : ''}`}
                  onClick={() => setSelectedAmbulance(ambulance)}
                  data-testid={`ambulance-card-${ambulance.call_sign}`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-zinc-100">{ambulance.call_sign}</span>
                      <div className={`status-dot ${ambulance.status}`} />
                    </div>
                    <div className="space-y-1 text-xs text-zinc-400">
                      {ambulance.driver_name && (
                        <div className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {ambulance.driver_name}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        <span className="data-value">{ambulance.location?.lat?.toFixed(4)}, {ambulance.location?.lng?.toFixed(4)}</span>
                      </div>
                      {ambulance.speed > 0 && (
                        <div className="flex items-center gap-1">
                          <Navigation className="w-3 h-3" />
                          <span className="data-value">{ambulance.speed?.toFixed(0)} km/h</span>
                        </div>
                      )}
                    </div>
                    {ambulance.status === 'emergency' && (
                      <Button 
                        size="sm" 
                        className="w-full mt-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs"
                        onClick={(e) => { e.stopPropagation(); sendEmergencyAlert(ambulance.id); }}
                        data-testid={`send-alert-${ambulance.call_sign}`}
                      >
                        <Send className="w-3 h-3 mr-1" />
                        Broadcast Alert
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <MapContainer
            center={mapCenter}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
            className="z-0"
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap'
            />
            
            {/* Ambulance markers */}
            {ambulances.map(ambulance => (
              <Marker 
                key={ambulance.id}
                position={[ambulance.location?.lat || 0, ambulance.location?.lng || 0]}
                icon={createAmbulanceIcon(ambulance.status)}
                eventHandlers={{ click: () => setSelectedAmbulance(ambulance) }}
              >
                <Popup>
                  <div className="text-sm p-1">
                    <strong>{ambulance.call_sign}</strong>
                    <br />
                    Status: <Badge variant={ambulance.status === 'emergency' ? 'destructive' : 'secondary'} className="text-xs">{ambulance.status?.toUpperCase()}</Badge>
                    <br />
                    {ambulance.driver_name && <>Driver: {ambulance.driver_name}</>}
                  </div>
                </Popup>
              </Marker>
            ))}
            
            {/* Hospital markers */}
            {hospitals.map(hospital => (
              <Marker 
                key={hospital.id}
                position={[hospital.coordinates?.lat || 0, hospital.coordinates?.lng || 0]}
                icon={hospitalIcon}
                eventHandlers={{ click: () => setSelectedHospital(hospital) }}
              >
                <Popup>
                  <div className="text-sm p-1">
                    <strong>{hospital.name}</strong>
                    <br />
                    Beds: {hospital.availability}
                    <br />
                    {hospital.specialties?.join(', ')}
                  </div>
                </Popup>
              </Marker>
            ))}
            
            {/* Traffic events */}
            {trafficEvents.map(event => (
              <Marker 
                key={event.id}
                position={[event.location?.lat || 0, event.location?.lng || 0]}
                icon={trafficIcon}
              >
                <Popup>
                  <div className="text-sm p-1">
                    <strong>{event.event_type?.toUpperCase()}</strong>
                    <br />
                    Severity: {event.severity}/5
                    <br />
                    {event.description}
                  </div>
                </Popup>
              </Marker>
            ))}
            
            {/* Route polyline */}
            {currentRoute && (
              <Polyline
                positions={currentRoute.points?.map(p => [p.lat, p.lng]) || []}
                color="#ef4444"
                weight={4}
                dashArray="10, 10"
              />
            )}
          </MapContainer>

          {/* Alerts HUD */}
          {alerts.length > 0 && (
            <div className="map-hud map-hud-top-right">
              <Card className="glass-card w-64 border-red-500/50">
                <CardHeader className="p-3 pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    Recent Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <ScrollArea className="h-32">
                    <div className="space-y-2">
                      {alerts.slice(0, 5).map((alert, i) => (
                        <div key={i} className="text-xs text-zinc-300 p-2 bg-zinc-800/50 rounded">
                          <span className="text-red-400 font-semibold">{alert.call_sign}</span>
                          <br />
                          {alert.message}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Right sidebar - Hospitals */}
        <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col">
          <div className="p-4 border-b border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Hospital className="w-4 h-4 text-blue-500" />
                Hospitals ({filteredHospitals.length})
              </h2>
            </div>
            <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 text-xs" data-testid="specialty-filter">
                <SelectValue placeholder="Filter by specialty" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="all" className="text-zinc-100">All Specialties</SelectItem>
                {allSpecialties.map(spec => (
                  <SelectItem key={spec} value={spec} className="text-zinc-100">{spec}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {filteredHospitals.map(hospital => (
                <Card 
                  key={hospital.id}
                  className={`bg-zinc-800 border-zinc-700 cursor-pointer hover:border-zinc-600 transition-all ${selectedHospital?.id === hospital.id ? 'border-blue-500 ring-1 ring-blue-500/20' : ''}`}
                  onClick={() => setSelectedHospital(hospital)}
                  data-testid={`hospital-card-${hospital.id}`}
                >
                  <CardContent className="p-3">
                    <h4 className="font-medium text-zinc-100 text-sm mb-1">{hospital.name}</h4>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {hospital.specialties?.slice(0, 3).map(spec => (
                        <Badge key={spec} variant="secondary" className="specialty-badge bg-zinc-700 text-zinc-300 text-xs">
                          {spec}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <div className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        <span>{hospital.availability} beds</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        <span className="data-value">{hospital.address?.split(',')[0] || 'N/A'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          {/* Assignment Panel */}
          <div className="p-4 border-t border-zinc-800 space-y-3">
            <div className="text-xs text-zinc-500 space-y-1">
              <div>
                <span className="text-zinc-400">Selected Unit:</span>{' '}
                <span className="text-zinc-100">{selectedAmbulance?.call_sign || 'None'}</span>
              </div>
              <div>
                <span className="text-zinc-400">Target Hospital:</span>{' '}
                <span className="text-zinc-100">{selectedHospital?.name || 'None'}</span>
              </div>
            </div>
            <Button 
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium uppercase text-xs tracking-wide"
              onClick={assignHospital}
              disabled={!selectedAmbulance || !selectedHospital}
              data-testid="assign-hospital-btn"
            >
              <Navigation className="w-4 h-4 mr-2" />
              Assign Route
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DispatcherDashboard;
