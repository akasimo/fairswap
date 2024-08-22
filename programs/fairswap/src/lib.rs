use anchor_lang::prelude::*;

declare_id!("69hNfSV6nw46VXAJ3ukAQhSXikKdX2L3nP4UkLDEMnrr");

#[program]
pub mod fairswap {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
