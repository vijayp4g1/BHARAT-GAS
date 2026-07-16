import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Loader2, UserPlus, Users, Trash2, X, User, Phone, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ManagerBottomNav } from '../components/ManagerBottomNav';

export const ManagerAgents = () => {
  const [agents, setAgents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  
  // Form State
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'AGENT' | 'MANAGER'>('AGENT');

  const fetchAgents = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .neq('status', 'DELETED')
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setAgents(data || []);
    } catch (error) {
      console.error('Error fetching agents:', error);
      toast.error('Failed to load agents list');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !username || !password) {
      toast.error('Please fill in all fields (including password)');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      const safeUsername = username.toLowerCase().trim();

      // Call the edge function securely
      const { data, error } = await supabase.functions.invoke('create-agent', {
        body: {
          name,
          username: safeUsername,
          password,
          phone,
          role
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to create agent');
      }

      toast.success('Agent account created! They can now log in.');
      
      setAgents([data, ...agents]);
      setName('');
      setUsername('');
      setPassword('');
      setPhone('');
      setIsAddModalOpen(false);
    } catch (error: any) {
      console.error('Error creating agent:', error);
      if (error.message?.includes('already registered')) {
        toast.error('This username already exists');
      } else {
        toast.error(error.message || 'Failed to create agent account');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) {
      toast.error('Please enter a name');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('agents')
        .update({ name, phone, role })
        .eq('id', editingAgent.id);

      if (error) throw error;

      toast.success('Agent updated successfully');
      
      setAgents(agents.map(a => a.id === editingAgent.id ? { ...a, name, phone, role } : a));
      setIsEditModalOpen(false);
    } catch (error: any) {
      console.error('Error updating agent:', error);
      toast.error('Failed to update agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (agent: any) => {
    setEditingAgent(agent);
    setName(agent.name);
    setPhone(agent.phone || '');
    setRole(agent.role);
    setIsEditModalOpen(true);
  };

  const openAddModal = () => {
    setName('');
    setUsername('');
    setPassword('');
    setPhone('');
    setRole('AGENT');
    setIsAddModalOpen(true);
  };

  const handleDelete = (id: string) => {
    toast((t) => (
      <div className="flex flex-col gap-3">
        <p className="font-bold text-slate-800">Delete this agent?</p>
        <p className="text-sm text-slate-500">This action cannot be undone.</p>
        <div className="flex gap-2 mt-1">
          <button 
            onClick={() => {
              toast.dismiss(t.id);
              executeDelete(id);
            }} 
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-bold flex-1 transition-colors"
          >
            Delete
          </button>
          <button 
            onClick={() => toast.dismiss(t.id)} 
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold flex-1 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };

  const executeDelete = async (id: string) => {
    try {
      const { error: dbError } = await supabase.from('agents').update({ status: 'DELETED' }).eq('id', id);
      if (dbError) throw dbError;
      
      toast.success('Agent deleted');
      setAgents(agents.filter(a => a.id !== id));
    } catch (error) {
      console.error('Error deleting agent:', error);
      toast.error('Failed to delete agent');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20 md:pb-10">
      <header className="glass-header text-white p-4 sm:p-5 sticky top-0 z-20 flex items-center gap-3">
        <Link to="/manager/dashboard" className="p-2 hover:bg-white/20 rounded-xl transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold flex-1 flex items-center gap-2">
          <Users size={22} className="text-blue-200" /> 
          Team Members
        </h1>
        <button 
          onClick={openAddModal}
          className="flex items-center gap-2 bg-white text-blue-900 hover:bg-blue-50 px-3 sm:px-4 py-2 rounded-xl font-bold transition-all shadow-lg text-sm sm:text-base active:scale-95"
        >
          <UserPlus size={18} /> <span className="hidden sm:inline">Add Member</span>
        </button>
      </header>

      <ManagerBottomNav />

      <main className="max-w-6xl w-full mx-auto p-4 sm:p-5 md:p-8 space-y-6 mt-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="animate-spin text-blue-500 mb-4" size={40} />
            <p className="text-slate-500 font-medium">Loading team members...</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 glass-card rounded-3xl border-dashed border-2 border-slate-200">
            <div className="w-20 h-20 bg-blue-50 text-blue-300 rounded-full flex items-center justify-center mb-4">
              <Users size={40} />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">No team members</h3>
            <p className="text-slate-500 mb-6 max-w-md text-center">Add delivery agents and managers to your team so they can start collecting consumer data.</p>
            <button 
              onClick={openAddModal}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold transition-colors shadow-lg shadow-blue-500/30 flex items-center gap-2"
            >
              <UserPlus size={20} /> Create First Account
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(agent => (
              <div key={agent.id} className="glass-card glass-card-hover p-5 rounded-2xl flex flex-col group relative overflow-hidden">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0 ${
                      agent.role === 'MANAGER' 
                        ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                        : 'bg-blue-100 text-blue-700 border border-blue-200'
                    }`}>
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg leading-tight">{agent.name}</h3>
                      <p className="text-sm text-slate-500 font-mono mt-0.5">@{agent.username}</p>
                      {agent.phone && (
                        <p className="text-sm text-slate-500 mt-1 flex items-center gap-1">
                          <Phone size={12} /> {agent.phone}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-auto pt-4 border-t border-slate-100">
                  <div className="flex gap-2">
                    <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md ${
                      agent.role === 'MANAGER' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'
                    }`}>
                      {agent.role}
                    </span>
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider rounded-md">
                      {agent.status}
                    </span>
                  </div>
                  
                  <div className="flex gap-2">
                    <button 
                      onClick={() => openEditModal(agent)}
                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Edit Agent"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => handleDelete(agent.id)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete Agent"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Slide-in Modal for Add Agent */}
      <div className={`fixed inset-0 z-[100] flex justify-end bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${isAddModalOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className={`bg-white w-full max-w-md h-full flex flex-col shadow-2xl transition-transform duration-300 transform ${isAddModalOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 flex justify-between items-center text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 rounded-full bg-white/10 blur-2xl"></div>
            <h2 className="text-xl font-bold flex items-center gap-2 relative z-10">
              <UserPlus size={20} /> Create Account
            </h2>
            <button onClick={() => setIsAddModalOpen(false)} className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-full transition-colors relative z-10">
              <X size={20} />
            </button>
          </div>
          
          <form onSubmit={handleCreateAgent} className="p-6 flex-1 overflow-y-auto flex flex-col gap-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Full Name *</label>
              <input
                type="text"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all font-medium placeholder:text-slate-400"
                placeholder="e.g. Rahul Kumar"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Username *</label>
              <div className="relative flex items-center">
                <span className="absolute left-4 text-slate-400 font-bold">@</span>
                <input
                  type="text"
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all font-medium placeholder:text-slate-400"
                  placeholder="rahul_k"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1.5 ml-1">This will be used for login.</p>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Phone Number</label>
              <input
                type="tel"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all font-medium placeholder:text-slate-400"
                placeholder="e.g. 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Password *</label>
              <input
                type="text"
                required
                minLength={6}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all font-medium placeholder:text-slate-400"
                placeholder="Min. 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Role *</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRole('AGENT')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                    role === 'AGENT' 
                      ? 'border-blue-500 bg-blue-50 text-blue-700' 
                      : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200'
                  }`}
                >
                  <User size={24} className="mb-2" />
                  <span className="font-bold text-sm">Agent</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole('MANAGER')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                    role === 'MANAGER' 
                      ? 'border-purple-500 bg-purple-50 text-purple-700' 
                      : 'border-slate-200 bg-white text-slate-500 hover:border-purple-200'
                  }`}
                >
                  <Users size={24} className="mb-2" />
                  <span className="font-bold text-sm">Manager</span>
                </button>
              </div>
            </div>
            
            <div className="mt-auto pt-6">
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-400 disabled:to-slate-400 text-white font-bold py-4 px-4 rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 active:scale-[0.98] transition-all flex justify-center items-center gap-2"
              >
                {isSubmitting ? <Loader2 size={20} className="animate-spin" /> : <UserPlus size={20} />}
                Create Account
              </button>
            </div>
          </form>
        </div>
      </div>
      {/* Slide-in Modal for Edit Agent */}
      <div className={`fixed inset-0 z-[100] flex justify-end bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${isEditModalOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className={`bg-white w-full max-w-md h-full flex flex-col shadow-2xl transition-transform duration-300 transform ${isEditModalOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 flex justify-between items-center text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 rounded-full bg-white/10 blur-2xl"></div>
            <h2 className="text-xl font-bold flex items-center gap-2 relative z-10">
              <Edit2 size={20} /> Edit Account
            </h2>
            <button onClick={() => setIsEditModalOpen(false)} className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-full transition-colors relative z-10">
              <X size={20} />
            </button>
          </div>
          
          <form onSubmit={handleEditAgent} className="p-6 flex-1 overflow-y-auto flex flex-col gap-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Full Name *</label>
              <input
                type="text"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all font-medium placeholder:text-slate-400"
                placeholder="e.g. Rahul Kumar"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Phone Number</label>
              <input
                type="tel"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all font-medium placeholder:text-slate-400"
                placeholder="e.g. 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Role *</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRole('AGENT')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                    role === 'AGENT' 
                      ? 'border-blue-500 bg-blue-50 text-blue-700' 
                      : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200'
                  }`}
                >
                  <User size={24} className="mb-2" />
                  <span className="font-bold text-sm">Agent</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole('MANAGER')}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                    role === 'MANAGER' 
                      ? 'border-purple-500 bg-purple-50 text-purple-700' 
                      : 'border-slate-200 bg-white text-slate-500 hover:border-purple-200'
                  }`}
                >
                  <Users size={24} className="mb-2" />
                  <span className="font-bold text-sm">Manager</span>
                </button>
              </div>
            </div>
            
            <div className="mt-auto pt-6">
              <button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-400 disabled:to-slate-400 text-white font-bold py-4 px-4 rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 active:scale-[0.98] transition-all flex justify-center items-center gap-2"
              >
                {isSubmitting ? <Loader2 size={20} className="animate-spin" /> : <Edit2 size={20} />}
                Update Account
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
