// Generated from typed Quint IR. Do not edit.
// Quint: 0.33.0; IR SHA-256: 9ea3f0ec5ae8d4081c03f1fd8b9b95be88dc0e129af9246f08d034ce334090c5
// Scope: explicitly selected action relations, not complete behavior/liveness refinement.
use vstd::prelude::*;

verus! {
    pub struct ModelState {
        pub balance: int,
        pub transactions: int,
    }

    pub open spec fn model_init(post: ModelState) -> bool {
        (post.balance == (0int)) &&
        (post.transactions == (0int))
    }

    pub open spec fn model_deposit_enabled(pre: ModelState, arg0: int) -> bool {
        ((arg0 > (0int))) &&
        (((pre.balance + arg0) <= (1000int))) &&
        ((pre.transactions < (1000int)))
    }

    pub open spec fn model_deposit(pre: ModelState, post: ModelState, arg0: int) -> bool {
        (model_deposit_enabled(pre, arg0)) &&
        (post.balance == (pre.balance + arg0)) &&
        (post.transactions == (pre.transactions + (1int)))
    }

    pub open spec fn model_withdraw_enabled(pre: ModelState, arg0: int) -> bool {
        ((arg0 > (0int))) &&
        ((arg0 <= pre.balance)) &&
        ((pre.transactions < (1000int)))
    }

    pub open spec fn model_withdraw(pre: ModelState, post: ModelState, arg0: int) -> bool {
        (model_withdraw_enabled(pre, arg0)) &&
        (post.balance == (pre.balance - arg0)) &&
        (post.transactions == (pre.transactions + (2int)))
    }

    pub open spec fn model_state_invariant(state: ModelState) -> bool {
        ((state.balance >= (0int)) && (state.balance <= (1000int)) && (state.transactions >= (0int)) && (state.transactions <= (1000int)))
    }
}
