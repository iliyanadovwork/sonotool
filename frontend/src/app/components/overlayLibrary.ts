// AUTO-GENERATED — developer overlay-texture library hosted in the Supabase "overlay-textures" bucket.
// Regenerate with scripts/genOverlayManifest.mjs (or scripts/uploadOverlays.mjs when adding more).
export const OVERLAY_BUCKET = 'overlay-textures';
export const OVERLAY_IDS: string[] = ["001","002","003","004","005","006","007","008","009","010","011","012","013","014","015","016","017","018","019","020","021","022","023","024","025","026","027","028","029","030","031","032","033","034","035","036","037","038","039","040","041","042","043","044","045","046","047","048","049","050","051","052","053","055","056","057","058","059","060","061","062","063","064","065","066","067","068","069","070","072","073","074"];
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const overlayUrl = (id: string) => `${BASE}/storage/v1/object/public/overlay-textures/overlays/${id}.jpg`;
export const overlayThumbUrl = (id: string) => `${BASE}/storage/v1/object/public/overlay-textures/overlays/thumbs/${id}.jpg`;
