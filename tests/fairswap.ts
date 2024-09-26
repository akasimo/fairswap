import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Fairswap } from "../target/types/fairswap";

import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID as tokenProgram, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { randomBytes } from "crypto"
import { assert, expect } from "chai"
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { confirmTx, confirmTxs, logBalances, newMintToAta } from "./utils";


describe("fairswap general amm functions", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Fairswap as Program<Fairswap>;
  const [initializer, user1, user2] = [new Keypair(), new Keypair(), new Keypair()];

  // Random seed
  const seed = new BN(randomBytes(8));
  const auth = PublicKey.findProgramAddressSync([Buffer.from("auth")], program.programId)[0];

  let mint_x: PublicKey;
  let mint_y: PublicKey;
  let mint_lp: PublicKey;
  let config: PublicKey;
  let initializer_x_ata: PublicKey;
  let initializer_y_ata: PublicKey;
  let initializer_lp_ata: PublicKey;
  let user1_x_ata: PublicKey;
  let user1_y_ata: PublicKey;
  let user2_x_ata: PublicKey;
  let user2_y_ata: PublicKey;
  let vault_x_ata: PublicKey;
  let vault_y_ata: PublicKey;
  let vault_lp_ata: PublicKey;

  // ATAs
  it("Airdrop", async () => {
    await Promise.all([initializer, user1, user2].map(async (k) => {
      return await anchor.getProvider().connection.requestAirdrop(k.publicKey, 100 * anchor.web3.LAMPORTS_PER_SOL)
    })).then(confirmTxs);
  });

  // Create mints and ATAs
  it("Create mints, tokens and ATAs", async () => {
    let [u1, u2] = await Promise.all([initializer, initializer].map(async (a) => { return await newMintToAta(anchor.getProvider().connection, a, 1e8) }))
    mint_x = u1.mint;
    mint_y = u2.mint;
    initializer_x_ata = u1.ata;
    initializer_y_ata = u2.ata;

    // //user currently not used but creating for future tests
    // user1_x_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_x, user1.publicKey, 5000);
    // user1_y_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_y, user1.publicKey, 0);
    // user2_x_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_x, user2.publicKey, 5000);
    // user2_y_ata = await createAndFundATA(anchor.getProvider().connection, initializer, mint_y, user2.publicKey, 0);

    config = PublicKey.findProgramAddressSync([Buffer.from("config"), mint_x.toBuffer(), mint_y.toBuffer(), seed.toBuffer().reverse()], program.programId)[0];
    mint_lp = PublicKey.findProgramAddressSync([Buffer.from("mint_lp"), config.toBuffer()], program.programId)[0];
    initializer_lp_ata = await getAssociatedTokenAddress(mint_lp, initializer.publicKey, false, tokenProgram);

    // Create take ATAs
    vault_x_ata = await getAssociatedTokenAddress(mint_x, auth, true, tokenProgram);
    vault_y_ata = await getAssociatedTokenAddress(mint_y, auth, true, tokenProgram);
    vault_lp_ata = await getAssociatedTokenAddress(mint_lp, auth, true, tokenProgram);
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

  it("Sandwich Self", async () => {
    const swapAccounts = {
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
    }

    const ix1 = await program.methods.swap(
      mint_y,
      new BN(15000),
      new BN(800)
    ).accountsPartial(swapAccounts).instruction();

    const ix2 = await program.methods.swap(
      mint_y,
      new BN(15000),
      new BN(800)
    ).accountsPartial(swapAccounts).instruction();

    const ix3 = await program.methods.swap(
      mint_x,
      new BN(18191),
      new BN(800)
    ).accountsPartial(swapAccounts).instruction();
    const tx = new anchor.web3.Transaction().add(ix1, ix2, ix3);
    const txSignature = await anchor.web3.sendAndConfirmTransaction(
      program.provider.connection,
      tx,
      [initializer]
    );
    // const txSignature = await program.provider.connection.sendTransaction(
    //   tx,
    //   [initializer],
    //   { skipPreflight: true }
    // );
    // await new Promise(resolve => setTimeout(resolve, 1000));
    // const txDetails = await program.provider.connection.getTransaction(txSignature, {
    //   maxSupportedTransactionVersion: 0,
    //   commitment: "confirmed"
    // });
    // console.log(txDetails);
    // // throw new Error("test");
    // const logs = txDetails?.meta?.logMessages || null;
    // if (logs) {
    //   console.log(logs);
    // }
    // if (txDetails?.meta?.err) {
    //   throw new Error(`Transaction failed: ${JSON.stringify(txDetails.meta.err)}`);
    // }
    console.log("Your sandwich transaction signature", txSignature);
    const currentSlot = await anchor.getProvider().connection.getSlot();
    console.log(`Current slot is ${currentSlot}`);
    await logBalances(initializer.publicKey, "sandwich self", mint_x, mint_y);
  });

  xit("real mev", async () => {
    console.log("user1 balances");
    await logBalances(user1.publicKey, "real mev", mint_x, mint_y);
    console.log("user2 balances");
    await logBalances(user2.publicKey, "real mev", mint_x, mint_y);
    console.log("user1 pubkey:", user1.publicKey.toBase58());
    console.log("user2 pubkey:", user2.publicKey.toBase58());

    const swapAccounts = {
      auth,
      user: user1.publicKey,
      mintX: mint_x,
      mintY: mint_y,
      vaultX: vault_x_ata,
      vaultY: vault_y_ata,
      config,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    }

    const tx_user1_1 = await program.methods.swap(
      mint_y,
      new BN(1500),
      new BN(80)
    ).accountsPartial({
      ...swapAccounts,
      userAtaX: user1_x_ata,
      userAtaY: user1_y_ata
    }).instruction();

    const tx_user2_1 = await program.methods.swap(
      mint_y,
      new BN(1500),
      new BN(80)
    ).accountsPartial({
      ...swapAccounts,
      userAtaX: user2_x_ata,
      userAtaY: user2_y_ata
    }).instruction();

    const tx_user1_2 = await program.methods.swap(
      mint_x,
      new BN(900),
      new BN(80)
    ).accountsPartial({
      ...swapAccounts,
      userAtaX: user1_x_ata,
      userAtaY: user1_y_ata
    }).instruction();
    // Add instructions in the desired order
    const tx = new anchor.web3.Transaction().add(tx_user1_1, tx_user1_2);

    // Sign the transaction with both users
    const txSignature = await anchor.web3.sendAndConfirmTransaction(
      program.provider.connection,
      tx,
      [user1, user2],
      { skipPreflight: true }
    );

    console.log("Your sandwich transaction signature", txSignature);
    const currentSlot = await anchor.getProvider().connection.getSlot();
    console.log(`Current slot is ${currentSlot}`);
    console.log("user1 balances");
    await logBalances(user1.publicKey, "real mev", mint_x, mint_y);
    console.log("user2 balances");
    await logBalances(user2.publicKey, "real mev", mint_x, mint_y);
  })

  it("Withdraw", async () => {
    const tx = await program.methods.withdraw(
      new BN(2e5),
      new BN(2e5 * 0.49),
      new BN(3e5 * 0.49)
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

