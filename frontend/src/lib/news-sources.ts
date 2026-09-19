// Curator Twitter handles stored in the news_sources table.
// Soft-fails — callers should catch and proceed without curator tweets.

import { supabase } from './supabase';

export async function getHandlesByIndustry(industry: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('news_sources')
    .select('handle')
    .ilike('industry', industry)
    .order('handle');

  if (error) throw new Error(error.message);
  return (data ?? []).map(r => r.handle as string);
}
