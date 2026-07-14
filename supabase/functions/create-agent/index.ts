import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check if the requesting user is a MANAGER
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
    
    if (userError || !user) {
      throw new Error('Unauthorized')
    }

    // Managers log in with real emails (not @bgcls.local).
    // Agents log in with @bgcls.local dummy emails.
    // So: if user has a real email, they are the owner/manager → allow.
    // If user has @bgcls.local email, check the agents table for MANAGER role.
    const isAgentEmail = user.email?.endsWith('@bgcls.local');
    
    if (isAgentEmail) {
      const { data: agentData } = await supabaseClient
        .from('agents')
        .select('role')
        .eq('id', user.id)
        .single()

      if (agentData?.role !== 'MANAGER') {
        throw new Error('Forbidden: Only managers can create agents.')
      }
    }
    // If real email → they are the owner, allow through

    // Process request
    const { name, username, password, role } = await req.json()

    if (!name || !username || !password) {
      throw new Error('Missing required fields')
    }

    const safeUsername = username.toLowerCase().trim();
    const dummyEmail = `${safeUsername}@bgcls.local`;

    // Create user in Auth
    const { data: authData, error: authError } = await supabaseClient.auth.admin.createUser({
      email: dummyEmail,
      password: password,
      email_confirm: true,
    })

    if (authError) throw authError

    // Create user in database
    const { data: dbData, error: dbError } = await supabaseClient
      .from('agents')
      .insert({
        id: authData.user.id,
        name,
        username: safeUsername,
        role: role || 'AGENT',
        status: 'ACTIVE'
      })
      .select()
      .single()

    if (dbError) {
      // Rollback
      await supabaseClient.auth.admin.deleteUser(authData.user.id)
      throw dbError
    }

    return new Response(
      JSON.stringify(dbData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
