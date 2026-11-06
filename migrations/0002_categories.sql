-- Preserve original documents in history before updating classifications.
INSERT OR IGNORE INTO revisions(slug,version,document,status,saved_at)
SELECT slug,version,document,status,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM posts
WHERE category IN ('diary','study')
   OR (slug='2024-01-10-sea-on-the-map' AND category<>'writing');

UPDATE posts
SET category=CASE WHEN slug='2024-01-10-sea-on-the-map' THEN 'writing'
                  WHEN category='diary' THEN 'work' ELSE 'research' END,
    document=json_set(document,
      '$.category',CASE WHEN slug='2024-01-10-sea-on-the-map' THEN 'writing'
                       WHEN category='diary' THEN 'work' ELSE 'research' END,
      '$.tags',json(CASE WHEN slug='2024-01-10-sea-on-the-map'
          THEN (SELECT json_group_array(value) FROM json_each(json_extract(posts.document,'$.tags')) WHERE value<>'日記')
          ELSE json_extract(document,'$.tags') END)),
    version=version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE category IN ('diary','study')
   OR (slug='2024-01-10-sea-on-the-map' AND category<>'writing');
