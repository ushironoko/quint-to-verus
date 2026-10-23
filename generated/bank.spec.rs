// Generated from typed Quint IR. Do not edit.
// Quint: 0.33.0; IR SHA-256: 4625b399f92cb33f3243521c065bc274ec12381e257923c853db9ebc7fde3d1e
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
        (post.transactions == (pre.transactions + (1int)))
    }

    pub open spec fn model_state_invariant(state: ModelState) -> bool {
        ((state.balance >= (0int)) && (state.balance <= (1000int)) && (state.transactions >= (0int)) && (state.transactions <= (1000int)))
    }
}
