import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Fairswap } from "../target/types/fairswap";

import { PublicKey, Commitment, Keypair, SystemProgram } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID as tokenProgram, createMint, createAccount, mintTo, getAssociatedTokenAddress, TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token"
import { randomBytes } from "crypto"
import { assert, expect } from "chai"
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

const commitment: Commitment = "confirmed";

describe("fairswap general amm functions", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Fairswap as Program<Fairswap>;

  const [initializer, user1, user2] = [new Keypair(), new Keypair(), new Keypair()];

  // Random seed
  // const seed = new BN(randomBytes(8));
  const seed = new BN(randomBytes(8));
  const auth = PublicKey.findProgramAddressSync([Buffer.from("auth")], program.programId)[0];

  let mint_x: PublicKey;
  let mint_y: PublicKey;
  let mint_lp: PublicKey;
  let config: PublicKey;
  let initializer_x_ata: PublicKey;
  let initializer_y_ata: PublicKey;
  let initializer_lp_ata: PublicKey;
  let vault_x_ata: PublicKey;
  let vault_y_ata: PublicKey;
  let vault_lp_ata: PublicKey;

  // ATAs
  it("Airdrop", async () => {
    await Promise.all([initializer, user1, user2].map(async (k) => {
      return await anchor.getProvider().connection.requestAirdrop(k.publicKey, 100 * anchor.web3.LAMPORTS_PER_SOL)
    })).then(confirmTxs);
  });

  it("Create mints, tokens and ATAs", async () => {
    // Create mints and ATAs
    let [u1, u2] = await Promise.all([initializer, initializer].map(async (a) => { return await newMintToAta(anchor.getProvider().connection, a, 1e8) }))
    mint_x = u1.mint;
    mint_y = u2.mint;
    initializer_x_ata = u1.ata;
    initializer_y_ata = u2.ata;

    // const user1_x_ata = await createAccount(anchor.getProvider().connection, initializer, mint_x, user1.publicKey);
    // await mintTo(anchor.getProvider().connection, initializer, mint_x, user1_x_ata, user1, 10e7);

    // const user1_y_ata = await createAccount(anchor.getProvider().connection, initializer, mint_y, user1.publicKey);
    // await mintTo(anchor.getProvider().connection, initializer, mint_y, user1_y_ata, user1, 10e7);

    // const user2_x_ata = await createAccount(anchor.getProvider().connection, initializer, mint_x, user2.publicKey);
    // await mintTo(anchor.getProvider().connection, initializer, mint_x, user2_x_ata, user2, 10e7);

    // const user2_y_ata = await createAccount(anchor.getProvider().connection, initializer, mint_y, user2.publicKey);
    // await mintTo(anchor.getProvider().connection, initializer, mint_y, user2_y_ata, user2, 10e7);

    config = PublicKey.findProgramAddressSync([Buffer.from("config"), mint_x.toBuffer(), mint_y.toBuffer(), seed.toBuffer().reverse()], program.programId)[0];

    mint_lp = PublicKey.findProgramAddressSync([Buffer.from("mint_lp"), config.toBuffer()], program.programId)[0];

    initializer_lp_ata = await getAssociatedTokenAddress(mint_lp, initializer.publicKey, false, tokenProgram);
    // Create take ATAs
    vault_x_ata = await getAssociatedTokenAddress(mint_x, auth, true, tokenProgram);
    vault_y_ata = await getAssociatedTokenAddress(mint_y, auth, true, tokenProgram);
    vault_lp_ata = await getAssociatedTokenAddress(mint_lp, auth, true, tokenProgram);
    // user_x_ata = await getAssociatedTokenAddress(mint_x, user.publicKey, false, tokenProgram);
    // user_y_ata = await getAssociatedTokenAddress(mint_y, user.publicKey, false, tokenProgram);
    // user_lp_ata = await getAssociatedTokenAddress(mint_lp, user.publicKey, false, tokenProgram);
  })

  it("Initialize", async () => {
    console.log(`Mint1 is ${mint_x.toBase58()}`);
    console.log(`Mint2 is ${mint_y.toBase58()}`);
    console.log(`Mint LP is ${mint_lp.toBase58()}`);
    console.log(`Config is ${config.toBase58()}`);
    console.log(`Vault X is ${vault_x_ata.toBase58()}`);
    console.log(`Vault Y is ${vault_y_ata.toBase58()}`);
    console.log(`Vault LP is ${vault_lp_ata.toBase58()}`);
    const tx = await program.methods.initialize(
      seed,
      0
    )
      // .accounts({
      //   admin: initializer.publicKey,
      //   mintX: mint_x,
      //   mintY: mint_y,
      //   mintLp: mint_lp,
      //   vaultX: vault_x_ata,
      //   vaultY: vault_y_ata,
      //   config,
      //   tokenProgram: TOKEN_PROGRAM_ID,
      //   associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      //   systemProgram: SystemProgram.programId
      // })
      .accountsPartial({
        admin: initializer.publicKey,
        auth,
        mintX: mint_x,
        mintY: mint_y,
        // mintLp: mint_lp,
        vaultX: vault_x_ata,
        vaultY: vault_y_ata,
        config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .signers([
        initializer
      ]).rpc();
    await confirmTx(tx);
    console.log("Your transaction signature", tx);
    await logBalances(initializer.publicKey, "initialization", mint_x, mint_y);
  });

  it("Lock", async () => {
    const tx = await program.methods.lock()
      .accountsPartial({
        admin: initializer.publicKey,
        mintX: mint_x,
        mintY: mint_y,
        config,
        systemProgram: SystemProgram.programId
      })
      .signers([
        initializer
      ]).rpc();
    await confirmTx(tx);
    console.log("Your transaction signature", tx);
  });

  it("Fail to deposit during lock", async () => {
    try {
      const tx = await program.methods.deposit(
        new BN(2e5),
        new BN(2e5),
        new BN(3e5)
      )
        .accountsStrict({
          user: initializer.publicKey,
          auth,
          mintX: mint_x,
          mintY: mint_y,
          userAtaX: initializer_x_ata,
          userAtaY: initializer_y_ata,
          userAtaLp: initializer_lp_ata,
          vaultX: vault_x_ata,
          vaultY: vault_y_ata,
          mintLp: mint_lp,
          config,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId
        })
        .signers([initializer])
        .rpc();

      await confirmTx(tx);
      console.log("Your deposit transaction signature", tx);

      // If we reach here, the transaction succeeded unexpectedly
      assert.fail("Deposit transaction should have failed due to lock, but it succeeded");
    } catch (e) {
      if (e instanceof anchor.AnchorError) {
        expect(e.error.errorCode.code).to.equal(
          "PoolLocked",
          "Expected PoolLocked error, but got a different error"
        );
      } else {
        // If it's not an AnchorError, fail the test
        expect.fail(`Expected AnchorError, but got: ${e}`);
      }
    }
  });

  it("Unlock", async () => {
    const tx = await program.methods.unlock()
      .accountsPartial({
        admin: initializer.publicKey,
        mintX: mint_x,
        mintY: mint_y,
        config,
        systemProgram: SystemProgram.programId
      })
      .signers([
        initializer
      ]).rpc();
    await confirmTx(tx);
    console.log("Your transaction signature", tx);
  });

  it("Fail to lock", async () => {
    try {
      const tx = await program.methods.lock()
        .accountsPartial({
          admin: user1.publicKey,
          mintX: mint_x,
          mintY: mint_y,
          config,
          systemProgram: SystemProgram.programId
        })
        .signers([
          user1
        ]).rpc();
      console.log("Your transaction signature", tx);
      assert.fail("Transaction should have failed but succeeded");
    } catch (e) {
      let err = e as anchor.AnchorError;
      if (err.error.errorCode.code !== "Unauthorized") {
        throw (e)
      }
    }
  });

  it("Fail to unlock", async () => {
    try {
      const tx = await program.methods.unlock()
        .accountsPartial({
          admin: user2.publicKey,
          mintX: mint_x,
          mintY: mint_y,
          config,
          systemProgram: SystemProgram.programId
        })
        .signers([
          user2
        ]).rpc();
      console.log("Your transaction signature", tx);

      assert.fail("Transaction should have failed but succeeded");
    } catch (e) {
      let err = e as anchor.AnchorError;
      if (err.error.errorCode.code !== "Unauthorized") {
        throw (e)
      }
    }
  });

  it("Deposit", async () => {
    const tx = await program.methods.deposit(
      new BN(2e5),
      new BN(2e5),
      new BN(3e5)
    )
      .accountsStrict({
        user: initializer.publicKey,
        auth,
        mintX: mint_x,
        mintY: mint_y,
        userAtaX: initializer_x_ata,
        userAtaY: initializer_y_ata,
        userAtaLp: initializer_lp_ata,
        vaultX: vault_x_ata,
        vaultY: vault_y_ata,
        mintLp: mint_lp,
        config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .signers([
        initializer
      ]).rpc();
    await confirmTx(tx);
    console.log("Your deposit transaction signature", tx);
    await logBalances(initializer.publicKey, "deposit", mint_x, mint_y);
  });

  it("Swap X for Y", async () => {
    const tx = await program.methods.swap(
      mint_x,
      new BN(5000),
      new BN(6000)
    )
      .accountsPartial({
        auth,
        user: initializer.publicKey,
        mintX: mint_x,
        mintY: mint_y,
        userAtaX: initializer_x_ata,
        userAtaY: initializer_y_ata,
        vaultX: vault_x_ata,
        vaultY: vault_y_ata,
        config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .signers([
        initializer
      ]).rpc();
    await confirmTx(tx);
    console.log("Your transaction signature", tx);
    const currentSlot = await anchor.getProvider().connection.getSlot();
    console.log(`Current slot is ${currentSlot}`);
    await logBalances(initializer.publicKey, "swap X for Y", mint_x, mint_y);

  });

  it("Swap Y for X", async () => {
    const tx = await program.methods.swap(
      mint_y,
      new BN(7330),
      new BN(4500)
    )
      .accountsPartial({
        auth,
        user: initializer.publicKey,
        mintX: mint_x,
        mintY: mint_y,
        userAtaX: initializer_x_ata,
        userAtaY: initializer_y_ata,
        vaultX: vault_x_ata,
        vaultY: vault_y_ata,
        config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .signers([
        initializer
      ]).rpc();
    await confirmTx(tx);
    console.log("Your transaction signature", tx);
    const currentSlot = await anchor.getProvider().connection.getSlot();
    console.log(`Current slot is ${currentSlot}`);
    await logBalances(initializer.publicKey, "swap Y for X", mint_x, mint_y);
  });


  it("Withdraw", async () => {
    const tx = await program.methods.withdraw(
      new BN(2e5),
      new BN(2e5 * 0.99),
      new BN(3e5 * 0.99)
    )
      .accountsStrict({
        user: initializer.publicKey,
        auth,
        mintX: mint_x,
        mintY: mint_y,
        userAtaX: initializer_x_ata,
        userAtaY: initializer_y_ata,
        userAtaLp: initializer_lp_ata,
        vaultX: vault_x_ata,
        vaultY: vault_y_ata,
        mintLp: mint_lp,
        config,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .signers([
        initializer
      ]).rpc();
    await confirmTx(tx);
    console.log("Your withdraw transaction signature", tx);
    await logBalances(initializer.publicKey, "withdraw", mint_x, mint_y);
  });
});

// Helpers
const confirmTx = async (signature: string) => {
  const latestBlockhash = await anchor.getProvider().connection.getLatestBlockhash();
  await anchor.getProvider().connection.confirmTransaction(
    {
      signature,
      ...latestBlockhash,
    },
    commitment
  )
}

const confirmTxs = async (signatures: string[]) => {
  await Promise.all(signatures.map(confirmTx))
}

const newMintToAta = async (connection, minter: Keypair, amount): Promise<{ mint: PublicKey, ata: PublicKey }> => {
  const mint = await createMint(connection, minter, minter.publicKey, null, 6)
  // await getAccount(connection, mint, commitment)
  const ata = await createAccount(connection, minter, mint, minter.publicKey)
  const signature = await mintTo(connection, minter, mint, ata, minter, amount)
  await confirmTx(signature)
  return {
    mint,
    ata
  }
}

async function fetchTokenBalances(
  connection: anchor.web3.Connection,
  userPublicKey: PublicKey,
  mintX: PublicKey,
  mintY: PublicKey
): Promise<{ balanceX: BN, balanceY: BN }> {
  try {
    // Get the associated token accounts for the user
    const userAtaX = await getAssociatedTokenAddress(mintX, userPublicKey);
    const userAtaY = await getAssociatedTokenAddress(mintY, userPublicKey);

    // Fetch the account info for both token accounts
    const [accountX, accountY] = await Promise.all([
      getAccount(connection, userAtaX),
      getAccount(connection, userAtaY)
    ]);

    // Return the balances as BN
    return {
      balanceX: new BN(accountX.amount.toString()),
      balanceY: new BN(accountY.amount.toString())
    };
  } catch (error) {
    console.error("Error fetching token balances:", error);
    throw error;
  }
}

async function logBalances(userPublicKey: PublicKey, operation: string, mint_x: PublicKey, mint_y: PublicKey) {
  const connection = anchor.getProvider().connection;
  const balances = await fetchTokenBalances(connection, userPublicKey, mint_x, mint_y);
  console.log(`Balances after ${operation}:`);
  console.log(`  X: ${balances.balanceX.toString()}`);
  console.log(`  Y: ${balances.balanceY.toString()}`);
}