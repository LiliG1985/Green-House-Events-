// Gives the website and the /admin dashboard the Supabase address and public (anon) key.
// Both values are public by design; the database's security rules decide what each visitor can see.
// They are added to the Vercel project automatically when Supabase is connected under Storage.
module.exports = function handler(req, res) {
  var env = process.env;
  var url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || null;
  var key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY ||
            env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || null;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.statusCode = 200;
  res.end(JSON.stringify({ url: url, anonKey: key }));
};
