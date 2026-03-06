-- Atomic vote increment for arena matches.
-- Prevents race conditions where concurrent votes lose counts.

CREATE OR REPLACE FUNCTION increment_arena_vote(
  p_match_id UUID,
  p_vote_column TEXT
)
RETURNS TABLE(votes_a INT, votes_b INT, votes_tie INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_vote_column NOT IN ('votes_a', 'votes_b', 'votes_tie') THEN
    RAISE EXCEPTION 'Invalid vote column: %', p_vote_column;
  END IF;

  RETURN QUERY EXECUTE format(
    'UPDATE arena_matches SET %I = %I + 1 WHERE id = $1 RETURNING votes_a, votes_b, votes_tie',
    p_vote_column, p_vote_column
  ) USING p_match_id;
END;
$$;
