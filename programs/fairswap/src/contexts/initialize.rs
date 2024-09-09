use anchor_lang::prelude::*;
// use anchor_spl::{associated_token::AssociatedToken, token::{Mint, Token, TokenAccount}};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::errors::AmmError;
use crate::states::{Config, PoolData};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint_x: Box<InterfaceAccount<'info, Mint>>,
    pub mint_y: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint_x,
        associated_token::authority = auth,
        // associated_token::token_program = token_program,
    )]
    pub vault_x: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint_y,
        associated_token::authority = auth,
        // associated_token::token_program = token_program,
    )]
    pub vault_y: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: this is safe
    #[account(
        seeds = [b"auth"],
        bump,
    )]
    pub auth: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config".as_ref(), mint_x.key().as_ref(), mint_y.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = admin,
        space = 8 + PoolData::INIT_SPACE,
        seeds = [b"pooldata", config.key().as_ref()],
        bump
    )]
    pub pooldata: Box<Account<'info, PoolData>>,

    // #[account(
    //     init,
    //     payer = admin,
    //     seeds = [b"mint_lp", config.key().as_ref()],
    //     bump,
    //     mint::authority = auth,
    //     mint::decimals = 6,
    // )]
    // pub mint_lp: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn save_config(&mut self, seed: u64, fee: u16, bumps: &InitializeBumps) -> Result<()> {
        require!(fee < 10000, AmmError::InvalidFeeSet);
        self.config.set_inner(Config {
            authority: self.admin.key(),
            seed,
            fee,
            locked: false,
            mint_x: self.mint_x.key(),
            mint_y: self.mint_y.key(),
            // bump_lp: bumps.mint_lp,
            bump: bumps.config,
            bump_auth: bumps.auth
        });
        self.pooldata.set_inner(PoolData {
            last_slot: 0,
            buying_x_high: None,
            buying_y_high: None,
            precision: 6,
            bump: bumps.pooldata,
        });
        Ok(())
    }
}
