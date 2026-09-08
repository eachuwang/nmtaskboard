-- identities.username：稳定登录用户名（与显示名称分离；显示名可改、用户名不变）。
-- 回填规则：登录名不含 @（如内建 admin）沿用登录名；其余沿用注册时的显示名（即注册用户名）。
ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS username text;

UPDATE identities
SET username = login_name
WHERE username IS NULL
  AND login_name IS NOT NULL
  AND login_name <> ''
  AND position('@' in login_name) = 0;

UPDATE identities
SET username = display_name
WHERE username IS NULL;
