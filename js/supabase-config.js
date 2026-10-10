/* ==========================================================================
   ECOSOL PLANOS - Supabase Cloud Configuration
   ========================================================================== */

const SUPABASE_PROJECT_REF = "ymfbsydhprxolatfnzqz";
const SUPABASE_URL = "https://ymfbsydhprxolatfnzqz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ywssQLpMqKHdWnBec2mykQ_MhzXuH2P";

// Initialize Supabase Client
let supabaseClient = null;

if (window.supabase && typeof window.supabase.createClient === "function") {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true
        }
    });
} else {
    console.warn("Supabase SDK no está cargado. Verifique la etiqueta de script en index.html.");
}

window.supabaseClient = supabaseClient;
window.SUPABASE_URL = SUPABASE_URL;
