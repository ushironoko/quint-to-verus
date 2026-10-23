use vstd::prelude::*;
#[path = "../generated/bank.spec.rs"]
mod model;
use model::*;

verus! {
    pub struct Account {
        pub balance: u64,
        pub transactions: u64,
    }

    impl Account {
        pub open spec fn view(self) -> ModelState {
            ModelState {
                balance: self.balance as int,
                transactions: self.transactions as int,
            }
        }
    }

    pub fn new_account() -> (out: Account)
        ensures
            model_init(out.view()),
            model_state_invariant(out.view()),
    {
        Account { balance: 0, transactions: 0 }
    }

    pub fn deposit(account: Account, amount: u64) -> (out: Account)
        requires
            model_state_invariant(account.view()),
            model_deposit_enabled(account.view(), amount as int),
        ensures
            model_deposit(account.view(), out.view(), amount as int),
            model_state_invariant(out.view()),
    {
        Account {
            balance: account.balance + amount,
            transactions: account.transactions + 1,
        }
    }

    pub fn withdraw(account: Account, amount: u64) -> (out: Account)
        requires
            model_state_invariant(account.view()),
            model_withdraw_enabled(account.view(), amount as int),
        ensures
            model_withdraw(account.view(), out.view(), amount as int),
            model_state_invariant(out.view()),
    {
        Account {
            balance: account.balance - amount, // mutation: debit
            transactions: account.transactions, // mutation: counter
        }
    }

    fn main() {
        let account = new_account();
        let account = deposit(account, 100);
        let account = withdraw(account, 30);
        assert(account.balance == 70);
        assert(account.transactions == 2);
    }
}
