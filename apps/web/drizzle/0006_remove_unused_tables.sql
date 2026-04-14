-- Drop all legacy tables that are no longer in the schema.
-- Agent identity, relationships, and metadata are all ON-CHAIN now.
DROP TABLE IF EXISTS `review_records`;
DROP TABLE IF EXISTS `review_delegations`;
DROP TABLE IF EXISTS `capital_movements`;
DROP TABLE IF EXISTS `training_completions`;
DROP TABLE IF EXISTS `votes`;
DROP TABLE IF EXISTS `org_agents`;
DROP TABLE IF EXISTS `person_agents`;
DROP TABLE IF EXISTS `ai_agents`;
DROP TABLE IF EXISTS `gen_map_nodes`;
DROP TABLE IF EXISTS `demo_edges`;
DROP TABLE IF EXISTS `agent_index`;
