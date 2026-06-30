import * as supabaseClient from './supabaseClient';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({})) }));

describe('supabaseClient', () => {
  it('should export functions', () => {
    expect(supabaseClient).toBeDefined();
  });

  it('exports supabase', () => {
    const { supabase } = require('./supabaseClient');
    expect(supabase).toBeDefined();
  });
});
