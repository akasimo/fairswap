use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::states::Config;
use crate::errors::AmmError;

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint_x: InterfaceAccount<'info, Mint>,
    pub mint_y: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"config".as_ref(), mint_x.key().as_ref(), mint_y.key().as_ref(), config.seed.to_le_bytes().as_ref()],
        bump = config.bump
    )]
    pub config: Box<Account<'info, Config>>,

    pub system_program: Program<'info, System>,
}

impl<'info> Update<'info> {
    pub fn lock(&mut self) -> Result<()> {
        require!(self.config.authority == self.admin.key(), AmmError::Unauthorized);
        self.config.locked = true;
        Ok(())
    }

    pub fn unlock(&mut self) -> Result<()> {
        require!(self.config.authority == self.admin.key(), AmmError::Unauthorized);
        self.config.locked = false;
        Ok(())
    }
}
