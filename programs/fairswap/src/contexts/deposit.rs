use crate::errors::AmmError;
// use crate::states::PoolData;
use crate::{assert_not_locked, states::Config};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{mint_to, transfer_checked, MintTo, TransferChecked},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::assert_non_zero;
use constant_product_curve::ConstantProduct;

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Deposit<'info> {
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
        init_if_needed,
        payer = user,
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
        // mint::authority = config,
        // mint::decimals = 6,
        // mint::freeze_authority = config,
        // mint::token_program = token_program,
    )]
    mint_lp: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"amm".as_ref(), mint_x.key().as_ref(), mint_y.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump = config.bump,
    )]
    config: Account<'info, Config>,

    // #[account(
    //     mut,
    //     seeds = [b"pooldata", config.key().as_ref()],
    //     bump = pooldata.bump,
    // )]
    // pooldata: Account<'info, PoolData>,

    token_program: Interface<'info, TokenInterface>,
    associated_token_program: Program<'info, AssociatedToken>,
    system_program: Program<'info, System>,
}

impl<'info> Deposit<'info> {
    pub fn deposit(&mut self, amount: u64, max_x: u64, max_y: u64) -> Result<()> {
        require!(!self.config.locked, AmmError::PoolLocked);
        assert_non_zero!([amount, max_x, max_y]);
        assert_not_locked!(self);
        // let mut is_initialization = false;
        let (x, y) = match self.mint_lp.supply == 0
            && self.vault_x.amount == 0
            && self.vault_y.amount == 0
        {
            true => {
                // is_initialization = true;
                (max_x, max_y)
            }
            false => {
                let amounts = ConstantProduct::xy_deposit_amounts_from_l(
                    self.vault_x.amount,
                    self.vault_y.amount,
                    self.mint_lp.supply,
                    amount,
                    6,
                )
                .map_err(AmmError::from)?;
                (amounts.x, amounts.y)
            }
        };

        // if is_initialization {
        //     self.pooldata.last_slot = Clock::get()?.slot;
        //     self.pooldata.buying_x_high = calculate_limit_price(x, y, self.pooldata.precision)?;
        //     self.pooldata.buying_y_high = calculate_limit_price(y, x, self.pooldata.precision)?;
        //     // self.pooldata.price_x_low = (x as u128)
        //     //     .checked_mul(10u128.checked_pow(self.pooldata.precision as u32).ok_or(AmmError::InvalidPrecision)? as u128)
        //     //     .ok_or(AmmError::Overflow)?
        //     //     .checked_div(y as u128)
        //     //     .ok_or(AmmError::Overflow)?;
        //     // self.pooldata.price_y_low = (y as u128)
        //     //     .checked_mul(10u128.checked_pow(self.pooldata.precision as u32).ok_or(AmmError::InvalidPrecision)? as u128)
        //     //     .ok_or(AmmError::Overflow)?
        //     //     .checked_div(x as u128)
        //     //     .ok_or(AmmError::Overflow)?;
        //     // x vault:100, y: 10 => x fiyatı: x/y = 100/10 = 10. bu en kötü fiyat. yani x alırken 10dan fazla alamayacak
        // }

        require!(x <= max_x && y <= max_y, AmmError::SlippageExceeded);

        self.deposit_tokens(true, x)?;
        self.deposit_tokens(false, y)?;
        self.mint_lp_token(amount)
    }

    pub fn deposit_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (mint, decimals, vault, ata) = match is_x {
            true => (
                self.mint_x.to_account_info(),
                self.mint_x.decimals,
                self.vault_x.to_account_info(),
                self.user_ata_x.to_account_info(),
            ),
            false => (
                self.mint_y.to_account_info(),
                self.mint_y.decimals,
                self.vault_y.to_account_info(),
                self.user_ata_y.to_account_info(),
            ),
        };

        let accounts = TransferChecked {
            from: ata,
            to: vault,
            authority: self.user.to_account_info(),
            mint: mint,
        };

        let ctx = CpiContext::new(self.token_program.to_account_info(), accounts);

        transfer_checked(ctx, amount, decimals)?;

        Ok(())
    }

    pub fn mint_lp_token(&mut self, amount: u64) -> Result<()> {
        let accounts = MintTo {
            mint: self.mint_lp.to_account_info(),
            authority: self.config.to_account_info(),
            to: self.user_ata_lp.to_account_info(),
        };

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

        let ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            accounts,
            signer_seeds,
        );

        mint_to(ctx, amount)
    }
}
