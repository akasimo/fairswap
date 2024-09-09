use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PoolData {
    pub last_slot: u64,
    pub buying_x_high: Option<u128>,
    pub buying_y_high: Option<u128>,
    pub bump: u8,
    pub precision: u8,
}
