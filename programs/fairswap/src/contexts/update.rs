use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::states::Config;

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Update<'info> {
    #[account(mut)]
    admin: Signer<'info>,

    mint_x: InterfaceAccount<'info, Mint>,
    mint_y: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"amm".as_ref(), mint_x.key().as_ref(), mint_y.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump
    )]
    config: Account<'info, Config>,

    system_program: Program<'info, System>,
}

impl<'info> Update<'info> {
    pub fn lock(&mut self) -> Result<()> {
        self.config.locked = true;
        Ok(())
    }

    pub fn unlock(&mut self) -> Result<()> {
        self.config.locked = false;
        Ok(())
    }
}
