-- Add API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  client_name TEXT NOT NULL,
  tier TEXT DEFAULT 'Basic',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert dummy B2B keys
INSERT INTO api_keys (key, client_name, tier) VALUES 
('pm_basic_123', 'Individual Landlord', 'Basic'),
('pm_pro_456', 'Seoul Property Management', 'Pro'),
('pm_ultra_789', 'Global Real Estate Inc', 'Ultra');
