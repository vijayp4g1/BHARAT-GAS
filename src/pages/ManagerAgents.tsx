import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Loader2, UserPlus, Users, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export const ManagerAgents = () => {
  const [agents, setAgents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form State
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'AGENT' | 'MANAGER'>('AGENT');

  const fetchAgents = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
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
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Delete
          </button>
          <button 
            onClick={() => toast.dismiss(t.id)} 
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-medium flex-1 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    ), { duration: Infinity });
  };

  const executeDelete = async (id: string) => {
    try {
      // NOTE: For a full solution, a delete-agent edge function should be created.
      // We will soft-delete the agent by setting their status for now.
      const { error: dbError } = await supabase.from('agents').update({ status: 'DELETED' }).eq('id', id);
      if (dbError) throw dbError;
      
      toast.success('Agent deleted (soft delete)');
      setAgents(agents.filter(a => a.id !== id));
    } catch (error) {
      console.error('Error deleting agent:', error);
      toast.error('Failed to delete agent');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-blue-900 text-white p-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <Link to="/manager/dashboard" className="p-1 hover:bg-blue-800 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold flex-1 flex items-center gap-2">
          <Users size={20} /> Manage Agents
        </h1>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 w-full">
        {/* Create Agent Form */}
        <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <UserPlus size={20} className="text-blue-600" /> Create New Agent Account
          </h2>
          <form onSubmit={handleCreateAgent} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                className="block w-full px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                required
                className="block w-full px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="john_doe"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                className="block w-full px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="Minimum 6 chars"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                className="block w-full px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
              >
                <option value="AGENT">Delivery Agent</option>
                <option value="MANAGER">Manager</option>
              </select>
            </div>
            
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full flex justify-center items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 disabled:opacity-70 h-[42px]"
            >
              {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : 'Create Account'}
            </button>
          </form>
        </section>

        {/* Agents List */}
        <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
           <h2 className="text-lg font-bold text-gray-800 mb-4">Current Team</h2>
           
           {isLoading ? (
             <div className="flex justify-center py-8 text-gray-400">
                <Loader2 className="animate-spin" size={32} />
             </div>
           ) : agents.length === 0 ? (
             <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                No team members found. Create one above!
             </div>
           ) : (
             <div className="overflow-x-auto">
               <table className="w-full text-left border-collapse">
                 <thead>
                   <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                     <th className="p-3 font-semibold rounded-tl-lg">Name</th>
                     <th className="p-3 font-semibold">Username</th>
                     <th className="p-3 font-semibold">Role</th>
                     <th className="p-3 font-semibold">Status</th>
                     <th className="p-3 font-semibold text-center rounded-tr-lg">Actions</th>
                   </tr>
                 </thead>
                 <tbody>
                   {agents.map(agent => (
                     <tr key={agent.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                       <td className="p-3 font-medium text-gray-800">{agent.name}</td>
                       <td className="p-3 text-sm text-gray-600 font-mono bg-gray-50 rounded px-2">{agent.username}</td>
                       <td className="p-3">
                         <span className={`inline-block px-2 py-1 text-xs rounded-md font-medium ${agent.role === 'MANAGER' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                           {agent.role}
                         </span>
                       </td>
                       <td className="p-3">
                         <span className="inline-block px-2 py-1 bg-green-100 text-green-700 text-xs rounded-md font-medium">
                           {agent.status}
                         </span>
                       </td>
                       <td className="p-3 flex justify-center">
                         <button 
                           onClick={() => handleDelete(agent.id)}
                           className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                           title="Delete Agent"
                         >
                           <Trash2 size={18} />
                         </button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           )}
        </section>
      </main>
    </div>
  );
};
