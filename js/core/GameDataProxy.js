import { gameData } from './GameData.js';

export const AI_ACTION_TYPES = [
    '',
    'settle_new_village',
    'attack_weakest_neighbor',
    'farm_oases_in_radius',
    'rebalance_resources'
];

export const AI_ACTION_TRIGGERS = [
    'on_plan_complete',
    'on_under_attack',
    'on_resources_full',
    'on_enemy_weakened'
];

export const AI_GOAL_CATEGORIES = ['economic', 'military'];

export const BUILDING_TYPES = Object.keys(gameData.buildings).sort();

export const GENERIC_UNIT_TYPES = [
    'offensive_infantry', 
    'defensive_infantry', 
    'offensive_cavalry', 
    'defensive_cavalry', 
    'scout', 
    'siege', 
    'ram',
    'catapult',
    'settler'
].sort();

export const RESOURCE_TYPES = ['', 'Wood', 'Clay', 'Iron', 'Wheat'];

export const AI_CONDITION_TYPES = [
    'building_level',
    'resource_fields_level',
    'player_property',
    'research_completed',
    'village_count'
].sort();

export const AI_CONDITION_OPERATORS = ['>=', '<=', '==', '!=', '>', '<'];

export const AI_PLAYER_PROPERTIES = ['population'];

export const AI_STEP_TYPES = [
    'building', 
    'units', 
    'research', 
    'upgrade', 
    'resource_fields_level', 
    'proportional_units'
].sort();