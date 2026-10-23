module bank {
  pure val max_balance = 1000
  pure val max_transactions = 1000

  var balance: int
  var transactions: int

  action init = all {
    balance' = 0,
    transactions' = 0,
  }

  action deposit(amount: int): bool = all {
    amount > 0,
    balance + amount <= max_balance,
    transactions < max_transactions,
    balance' = balance + amount,
    transactions' = transactions + 1,
  }

  action withdraw(amount: int): bool = all {
    amount > 0,
    amount <= balance,
    transactions < max_transactions,
    balance' = balance - amount,
    transactions' = transactions + 1,
  }

  val state_invariant = and {
    balance >= 0,
    balance <= max_balance,
    transactions >= 0,
    transactions <= max_transactions,
  }

  // The driver covers the same amount range as the guarded public operations.
  // Nondeterminism in step is simulated by Quint, not translated by this PoC.
  action step = {
    nondet amount = 1.to(max_balance).oneOf()
    any {
      deposit(amount),
      withdraw(amount),
    }
  }
}
