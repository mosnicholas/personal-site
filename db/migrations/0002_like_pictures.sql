-- A like's picture stored in the public `likes` bucket (Supabase Storage), as
-- its path there; image_url stays as where the picture came from
ALTER TABLE likes ADD COLUMN image_path text;
