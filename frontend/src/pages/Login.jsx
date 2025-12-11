import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Ambulance, Shield, Radio } from 'lucide-react';
import { Toaster, toast } from 'sonner';

const Login = () => {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regRole, setRegRole] = useState('driver');

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const user = await login(loginEmail, loginPassword);
      toast.success(`Welcome back, ${user.name}!`);
      navigateByRole(user.role);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const user = await register(regEmail, regPassword, regName, regRole);
      toast.success('Account created successfully!');
      navigateByRole(user.role);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const navigateByRole = (role) => {
    switch (role) {
      case 'police':
        navigate('/police');
        break;
      case 'admin':
        navigate('/admin');
        break;
      case 'driver':
      default:
        navigate('/driver');
        break;
    }
  };

  return (
    <div className="min-h-screen flex">
      <Toaster position="top-right" richColors />
      
      {/* Left side - Hero */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-zinc-900 via-zinc-900 to-red-950">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1587745416684-47953f16f02f?w=1200')] bg-cover bg-center opacity-20" />
        <div className="relative z-10 flex flex-col justify-center p-12 text-white">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-14 h-14 rounded-xl bg-red-500 flex items-center justify-center">
              <Ambulance className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Emergency Alert</h1>
              <p className="text-sm text-zinc-400">Traffic System</p>
            </div>
          </div>
          <h2 className="text-4xl font-bold mb-4">Ambulance Emergency<br />Traffic Alert System</h2>
          <p className="text-zinc-400 text-lg max-w-md mb-8">
            Real-time coordination between ambulance drivers and traffic police for faster emergency response.
          </p>
          
          <div className="grid grid-cols-2 gap-6">
            <div className="flex items-start gap-3 p-4 bg-zinc-800/50 rounded-lg">
              <div className="w-10 h-10 rounded bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <Ambulance className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-zinc-100">Ambulance Driver</h3>
                <p className="text-sm text-zinc-500">Send instant alerts to traffic police</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 bg-zinc-800/50 rounded-lg">
              <div className="w-10 h-10 rounded bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold text-zinc-100">Traffic Police</h3>
                <p className="text-sm text-zinc-500">Receive alerts & clear routes</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-zinc-950">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-12 h-12 rounded-xl bg-red-500 flex items-center justify-center">
              <Ambulance className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-100">Emergency Alert</h1>
              <p className="text-xs text-zinc-500">Traffic System</p>
            </div>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-zinc-900">
              <TabsTrigger value="login" data-testid="login-tab">Sign In</TabsTrigger>
              <TabsTrigger value="register" data-testid="register-tab">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-zinc-100">Welcome back</CardTitle>
                  <CardDescription className="text-zinc-500">
                    Sign in as Ambulance Driver or Traffic Police
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email" className="text-zinc-300">Email</Label>
                      <Input
                        id="login-email"
                        data-testid="login-email-input"
                        type="email"
                        placeholder="name@example.com"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password" className="text-zinc-300">Password</Label>
                      <Input
                        id="login-password"
                        data-testid="login-password-input"
                        type="password"
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
                        required
                      />
                    </div>
                    <Button 
                      type="submit" 
                      data-testid="login-submit-btn"
                      className="w-full bg-red-500 hover:bg-red-600 text-white font-medium"
                      disabled={isLoading}
                    >
                      {isLoading ? 'Signing in...' : 'Sign In'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-zinc-100">Create account</CardTitle>
                  <CardDescription className="text-zinc-500">
                    Register as Ambulance Driver or Traffic Police
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reg-name" className="text-zinc-300">Full Name</Label>
                      <Input
                        id="reg-name"
                        data-testid="register-name-input"
                        type="text"
                        placeholder="John Doe"
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-email" className="text-zinc-300">Email</Label>
                      <Input
                        id="reg-email"
                        data-testid="register-email-input"
                        type="email"
                        placeholder="name@example.com"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-password" className="text-zinc-300">Password</Label>
                      <Input
                        id="reg-password"
                        data-testid="register-password-input"
                        type="password"
                        placeholder="••••••••"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-role" className="text-zinc-300">I am a</Label>
                      <Select value={regRole} onValueChange={setRegRole}>
                        <SelectTrigger 
                          data-testid="register-role-select"
                          className="bg-zinc-950 border-zinc-800 text-zinc-100"
                        >
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-800">
                          <SelectItem value="driver" className="text-zinc-100">
                            <div className="flex items-center gap-2">
                              <Ambulance className="w-4 h-4 text-red-400" />
                              <span>Ambulance Driver</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="police" className="text-zinc-100">
                            <div className="flex items-center gap-2">
                              <Shield className="w-4 h-4 text-blue-400" />
                              <span>Traffic Police</span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      type="submit" 
                      data-testid="register-submit-btn"
                      className="w-full bg-red-500 hover:bg-red-600 text-white font-medium"
                      disabled={isLoading}
                    >
                      {isLoading ? 'Creating account...' : 'Create Account'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Login;
