-- ============================================
-- PARANOIA GAME - Supabase Database Schema
-- Run this in your Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query → Paste & Run)
-- ============================================

-- 1. Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar TEXT DEFAULT '😈',
  games_played INT DEFAULT 0,
  times_pointed_at INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Custom questions table
CREATE TABLE IF NOT EXISTS custom_questions (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT,
  category TEXT DEFAULT 'custom',
  is_public BOOLEAN DEFAULT true,
  upvotes INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Question packs (for grouping custom questions)
CREATE TABLE IF NOT EXISTS question_packs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_public BOOLEAN DEFAULT true,
  category TEXT DEFAULT 'mixed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Pack-question junction
CREATE TABLE IF NOT EXISTS pack_questions (
  pack_id INT REFERENCES question_packs(id) ON DELETE CASCADE,
  question_id INT REFERENCES custom_questions(id) ON DELETE CASCADE,
  PRIMARY KEY (pack_id, question_id)
);

-- 5. Game history (optional - tracks completed games)
CREATE TABLE IF NOT EXISTS game_history (
  id SERIAL PRIMARY KEY,
  room_code TEXT,
  player_count INT,
  rounds_played INT,
  mode TEXT DEFAULT 'classic',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies

-- Profiles: anyone can read, only owner can update
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Custom questions: public ones visible to all, authors can manage their own
CREATE POLICY "Public questions are viewable by everyone" ON custom_questions FOR SELECT USING (is_public = true OR author_id = auth.uid());
CREATE POLICY "Authenticated users can create questions" ON custom_questions FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Authors can update their questions" ON custom_questions FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "Authors can delete their questions" ON custom_questions FOR DELETE USING (auth.uid() = author_id);

-- Question packs: public visible to all, authors manage their own
CREATE POLICY "Public packs are viewable by everyone" ON question_packs FOR SELECT USING (is_public = true OR author_id = auth.uid());
CREATE POLICY "Authenticated users can create packs" ON question_packs FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Authors can update their packs" ON question_packs FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "Authors can delete their packs" ON question_packs FOR DELETE USING (auth.uid() = author_id);

-- Pack questions: follow pack visibility
CREATE POLICY "Pack questions follow pack visibility" ON pack_questions FOR SELECT USING (true);
CREATE POLICY "Pack authors can manage pack questions" ON pack_questions FOR INSERT WITH CHECK (true);
CREATE POLICY "Pack authors can remove pack questions" ON pack_questions FOR DELETE USING (true);

-- Game history: anyone can insert, visible to all
CREATE POLICY "Game history is viewable" ON game_history FOR SELECT USING (true);
CREATE POLICY "Anyone can log games" ON game_history FOR INSERT WITH CHECK (true);

-- 8. Auto-create profile on signup (trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', 'Player'), COALESCE(NEW.raw_user_meta_data->>'avatar', '😈'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
