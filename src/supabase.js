import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    "Missing Supabase credentials. " +
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file (local) " +
    "or Netlify environment variables (production)."
  );
}

export const supabase = createClient(url, key);
