use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken, 
    token::{TransferChecked, transfer_checked, Burn, burn}, 
    token_interface::{ Mint, TokenAccount, TokenInterface}
};
use crate::{assert_not_locked, states::Config};
use crate::errors::AmmError;
use crate::assert_non_zero;

use constant_product_curve::ConstantProduct;

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    user: Signer<'info>,

    mint_x: InterfaceAccount<'info, Mint>,
    mint_y: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    user_ata_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    user_ata_y: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_lp,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    user_ata_lp: InterfaceAccount<'info, TokenAccount>,

    #[account(
        associated_token::mint = mint_x,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    vault_x: InterfaceAccount<'info, TokenAccount>,

    #[account(
        associated_token::mint = mint_x,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    vault_y: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"mint", config.key().as_ref()],
        bump = config.lp_bump,
    )]
    mint_lp: InterfaceAccount<'info, Mint>,

    #[account(
        has_one = mint_x,
        has_one = mint_y,
        seeds = [b"amm".as_ref(), mint_x.key().as_ref(), mint_y.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump = config.bump,
    )]
    config: Account<'info, Config>,

    token_program: Interface<'info, TokenInterface>,
    associated_token_program: Program<'info, AssociatedToken>,
    system_program: Program<'info, System>,
}

impl <'info> Withdraw<'info> {
    pub fn withdraw(&mut self, amount:u64, min_x: u64, min_y: u64) -> Result<()> {
        require!(!self.config.locked, AmmError::PoolLocked);
        assert_non_zero!([amount, min_x, min_y]);
        assert_not_locked!(self);

        let amounts = ConstantProduct::xy_withdraw_amounts_from_l(self.vault_x.amount, self.vault_y.amount, self.mint_lp.supply, amount, 6).map_err(AmmError::from)?;
        let (x, y) = (amounts.x, amounts.y);
        
        require!(x >= min_x && y >= min_y, AmmError::SlippageExceeded);

        self.withdraw_tokens(true, x)?;
        self.withdraw_tokens(false, y)?;
        self.burn_lp_tokens(amount)
    }

    pub fn withdraw_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {

        let binding_mint_x = self.mint_x.to_account_info().key();
        let binding_mint_y = self.mint_y.to_account_info().key();
        let binding_seed = self.config.seed.to_le_bytes();
        let seeds = &[
            &b"amm"[..],
            &binding_mint_x.as_ref(),
            &binding_mint_y.as_ref(),
            &binding_seed.as_ref(),
            &[self.config.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let (mint, decimals, vault, ata) = match is_x {
            true => (self.mint_x.to_account_info(), self.mint_x.decimals, self.vault_x.to_account_info(), self.user_ata_x.to_account_info()),
            false => (self.mint_y.to_account_info(), self.mint_y.decimals, self.vault_y.to_account_info(), self.user_ata_y.to_account_info()),
        };

        let accounts = TransferChecked {
            from: vault,
            to: ata,
            authority: self.config.to_account_info(),
            mint: mint
        };

        let ctx = CpiContext::new_with_signer(self.token_program.to_account_info(), accounts, signer_seeds);

        transfer_checked(ctx, amount, decimals)?;

        Ok(())
    }

    pub fn burn_lp_tokens(&mut self, amount: u64) -> Result<()> {
        let accounts = Burn {
            mint: self.mint_lp.to_account_info(),
            from: self.user_ata_lp.to_account_info(),
            authority: self.user.to_account_info(),
        };

        let ctx = CpiContext::new(
            self.token_program.to_account_info(),
            accounts
        );

        burn(ctx, amount)
    }
}