import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { 
  Users, Shield, Ambulance, Hospital, 
  Trash2, RefreshCw, LogOut, PlayCircle, Database, Route, Clock
} from 'lucide-react';
import { Toaster, toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const AdminPanel = () => {
  const { user, logout } = useAuth();
  const [users, setUsers] = useState([]);
  const [ambulances, setAmbulances] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [trips, setTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [usersRes, ambRes, hospRes, tripsRes] = await Promise.all([
        axios.get(`${API}/admin/users`),
        axios.get(`${API}/ambulances`),
        axios.get(`${API}/hospitals`),
        axios.get(`${API}/admin/trips`)
      ]);
      setUsers(usersRes.data);
      setAmbulances(ambRes.data);
      setHospitals(hospRes.data);
      setTrips(tripsRes.data);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('Failed to load admin data');
    }
  };

  const deleteUser = async (userId) => {
    if (!window.confirm('Delete this user?')) return;
    
    try {
      await axios.delete(`${API}/admin/users/${userId}`);
      toast.success('User deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete user');
    }
  };

  const seedData = async () => {
    setIsLoading(true);
    try {
      const response = await axios.post(`${API}/admin/seed-data`);
      toast.success(`Seeded ${response.data.hospitals} hospitals and ${response.data.ambulances} ambulances`);
      fetchData();
    } catch (error) {
      toast.error('Failed to seed data');
    } finally {
      setIsLoading(false);
    }
  };

  const stats = {
    totalUsers: users.length,
    drivers: users.filter(u => u.role === 'driver').length,
    admins: users.filter(u => u.role === 'admin').length,
    ambulances: ambulances.length,
    hospitals: hospitals.length,
    activeTrips: trips.filter(t => t.status === 'active').length,
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      <Toaster position="top-right" richColors />
      
      {/* Header */}
      <header className="h-16 bg-zinc-900 border-b border-zinc-800 px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-md bg-red-500 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">Admin Panel</h1>
            <p className="text-xs text-zinc-500">System Administration</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">{user?.name}</span>
          <Button variant="ghost" size="sm" onClick={fetchData} className="text-zinc-400 hover:text-zinc-100">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={logout} className="text-zinc-400 hover:text-zinc-100" data-testid="logout-btn">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      <div className="p-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-blue-500/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100 data-value">{stats.totalUsers}</p>
                  <p className="text-xs text-zinc-500">Total Users</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-green-500/20 flex items-center justify-center">
                  <Ambulance className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100 data-value">{stats.drivers}</p>
                  <p className="text-xs text-zinc-500">Drivers</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-red-500/20 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100 data-value">{stats.admins}</p>
                  <p className="text-xs text-zinc-500">Admins</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-amber-500/20 flex items-center justify-center">
                  <Ambulance className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100 data-value">{stats.ambulances}</p>
                  <p className="text-xs text-zinc-500">Ambulances</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-cyan-500/20 flex items-center justify-center">
                  <Hospital className="w-5 h-5 text-cyan-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100 data-value">{stats.hospitals}</p>
                  <p className="text-xs text-zinc-500">Hospitals</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-purple-500/20 flex items-center justify-center">
                  <Route className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100 data-value">{stats.activeTrips}</p>
                  <p className="text-xs text-zinc-500">Active Trips</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Seed Data */}
        <Card className="bg-zinc-900 border-zinc-800 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-zinc-100 flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-500" />
              Sample Data
            </CardTitle>
            <CardDescription className="text-zinc-500">
              Seed the database with sample hospitals and ambulances
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={seedData}
              disabled={isLoading}
              className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
              data-testid="seed-data-btn"
            >
              <PlayCircle className="w-4 h-4 mr-2" />
              {isLoading ? 'Seeding...' : 'Seed Sample Data'}
            </Button>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="users" className="space-y-4">
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="users" data-testid="users-tab">
              <Users className="w-4 h-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="ambulances" data-testid="ambulances-tab">
              <Ambulance className="w-4 h-4 mr-2" />
              Ambulances
            </TabsTrigger>
            <TabsTrigger value="hospitals" data-testid="hospitals-tab">
              <Hospital className="w-4 h-4 mr-2" />
              Hospitals
            </TabsTrigger>
            <TabsTrigger value="trips" data-testid="trips-tab">
              <Route className="w-4 h-4 mr-2" />
              Trips
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-zinc-100">User Management</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableHead className="text-zinc-400">Name</TableHead>
                      <TableHead className="text-zinc-400">Email</TableHead>
                      <TableHead className="text-zinc-400">Role</TableHead>
                      <TableHead className="text-zinc-400">Created</TableHead>
                      <TableHead className="text-zinc-400 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map(u => (
                      <TableRow key={u.id} className="border-zinc-800 hover:bg-zinc-800/50">
                        <TableCell className="text-zinc-100">{u.name}</TableCell>
                        <TableCell className="text-zinc-400">{u.email}</TableCell>
                        <TableCell>
                          <Badge variant={u.role === 'admin' ? 'destructive' : 'secondary'} className="text-xs">
                            {u.role?.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-zinc-500 text-sm data-value">{formatDate(u.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => deleteUser(u.id)}
                            disabled={u.id === user?.id}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            data-testid={`delete-user-${u.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Ambulances Tab */}
          <TabsContent value="ambulances">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-zinc-100">Fleet Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableHead className="text-zinc-400">Call Sign</TableHead>
                      <TableHead className="text-zinc-400">Status</TableHead>
                      <TableHead className="text-zinc-400">Driver</TableHead>
                      <TableHead className="text-zinc-400">Location</TableHead>
                      <TableHead className="text-zinc-400">Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ambulances.map(amb => (
                      <TableRow key={amb.id} className="border-zinc-800 hover:bg-zinc-800/50">
                        <TableCell className="text-zinc-100 font-medium">{amb.call_sign}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={`status-dot ${amb.status}`} />
                            <span className="text-zinc-300 text-sm">{amb.status?.toUpperCase()}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-zinc-400">{amb.driver_name || 'Unassigned'}</TableCell>
                        <TableCell className="text-zinc-500 text-sm data-value">
                          {amb.location?.lat?.toFixed(4)}, {amb.location?.lng?.toFixed(4)}
                        </TableCell>
                        <TableCell className="text-zinc-500 text-sm data-value">{formatDate(amb.last_updated)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Hospitals Tab */}
          <TabsContent value="hospitals">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-zinc-100">Hospital Directory</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                      <TableHead className="text-zinc-400">Name</TableHead>
                      <TableHead className="text-zinc-400">Specialties</TableHead>
                      <TableHead className="text-zinc-400">Phone</TableHead>
                      <TableHead className="text-zinc-400">Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hospitals.map(hosp => (
                      <TableRow key={hosp.id} className="border-zinc-800 hover:bg-zinc-800/50">
                        <TableCell className="text-zinc-100 font-medium">{hosp.name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {hosp.specialties?.slice(0, 3).map(spec => (
                              <Badge key={spec} variant="secondary" className="text-xs bg-zinc-700 text-zinc-300">
                                {spec}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-zinc-400 data-value">{hosp.phone}</TableCell>
                        <TableCell className="text-zinc-500 text-sm">{hosp.address || 'N/A'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Trips Tab */}
          <TabsContent value="trips">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-zinc-100">Trip Logs</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
                        <TableHead className="text-zinc-400">Driver</TableHead>
                        <TableHead className="text-zinc-400">Destination</TableHead>
                        <TableHead className="text-zinc-400">Status</TableHead>
                        <TableHead className="text-zinc-400">Traffic</TableHead>
                        <TableHead className="text-zinc-400">Started</TableHead>
                        <TableHead className="text-zinc-400">Completed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trips.map(trip => (
                        <TableRow key={trip.id} className="border-zinc-800 hover:bg-zinc-800/50">
                          <TableCell className="text-zinc-100">{trip.driver_name}</TableCell>
                          <TableCell className="text-zinc-300">{trip.destination_hospital_name}</TableCell>
                          <TableCell>
                            <Badge variant={trip.status === 'active' ? 'destructive' : 'secondary'} className="text-xs">
                              {trip.status?.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-zinc-400">{trip.traffic_conditions}</TableCell>
                          <TableCell className="text-zinc-500 text-sm data-value">{formatDate(trip.started_at)}</TableCell>
                          <TableCell className="text-zinc-500 text-sm data-value">{formatDate(trip.completed_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminPanel;
